"use strict";

const DHASH_ALGORITHM = "dhash64-v1";
const HASH_PATTERN = /^[a-f0-9]{16}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_RGB_DISTANCE = Math.sqrt(3 * 255 * 255);
const POPCOUNT_NIBBLE = Object.freeze([0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]);

/**
 * Build a deterministic 64-bit difference hash from normalized RGBA pixels.
 *
 * dHash64-v1 rules:
 * - Transparent pixels are composited over white with integer, half-up rounding.
 * - RGB luminance is floor((77R + 150G + 29B + 128) / 256).
 * - The luminance image is reduced to a 9 x 8 grid. A shrinking axis uses
 *   integer box-area weights; an enlarging axis uses pixel-centre nearest
 *   neighbour. The two axis rules are combined when only one axis shrinks.
 * - Each row contributes eight bits in left-to-right order. A bit is 1 only
 *   when the left sample is brighter than the right sample; ties are 0.
 * - The first comparison is the most-significant bit of a 16-character,
 *   lower-case hexadecimal string.
 *
 * averageRgb and luminanceVariance describe the composited source pixels, not
 * the 9 x 8 sampling grid. The variance is the rounded population variance of
 * the integer luminance values.
 *
 * @param {{pixels: Uint8Array|Uint8ClampedArray, width: number, height: number}} input
 * @returns {{algorithm: string, hash: string, averageRgb: Readonly<{r: number, g: number, b: number}>, luminanceVariance: number, aspectRatio: number}}
 */
function computeDHash64(input) {
  const { pixels, width, height, pixelCount } = validateRgbaInput(input);
  const luminances = new Uint8Array(pixelCount);
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;

  for (let index = 0, pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1, index += 4) {
    const alpha = pixels[index + 3];
    const red = compositeOnWhite(pixels[index], alpha);
    const green = compositeOnWhite(pixels[index + 1], alpha);
    const blue = compositeOnWhite(pixels[index + 2], alpha);
    const luminance = rgbLuminance(red, green, blue);

    redSum += red;
    greenSum += green;
    blueSum += blue;
    luminanceSum += luminance;
    luminanceSquareSum += luminance * luminance;
    luminances[pixelIndex] = luminance;
  }

  const grid = resampleLuminance(luminances, width, height, 9, 8);
  let hashValue = 0n;
  for (let row = 0; row < 8; row += 1) {
    const rowOffset = row * 9;
    for (let column = 0; column < 8; column += 1) {
      hashValue <<= 1n;
      if (grid[rowOffset + column] > grid[rowOffset + column + 1]) hashValue |= 1n;
    }
  }

  const meanLuminance = luminanceSum / pixelCount;
  const rawVariance = (luminanceSquareSum / pixelCount) - (meanLuminance * meanLuminance);
  const averageRgb = Object.freeze({
    r: roundPositiveRatio(redSum, pixelCount),
    g: roundPositiveRatio(greenSum, pixelCount),
    b: roundPositiveRatio(blueSum, pixelCount)
  });

  return Object.freeze({
    algorithm: DHASH_ALGORITHM,
    hash: hashValue.toString(16).padStart(16, "0"),
    averageRgb,
    luminanceVariance: Math.max(0, Math.floor(rawVariance + 0.5)),
    aspectRatio: width / height
  });
}

/**
 * Return the number of different bits between two canonical 64-bit dHashes.
 *
 * @param {string} leftHash
 * @param {string} rightHash
 * @returns {number}
 */
function hammingDistance(leftHash, rightHash) {
  const left = normalizeDHash(leftHash, "leftHash");
  const right = normalizeDHash(rightHash, "rightHash");
  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    distance += POPCOUNT_NIBBLE[Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16)];
  }
  return distance;
}

/**
 * Classify a pair without treating a perceptual hash as proof of identity.
 *
 * Equal SHA-256 digests are the only path to `exact`. Otherwise all four
 * caller-owned thresholds are required. A dHash match is reported only as a
 * `similar_candidate`, suitable for a user-facing review step. When either
 * image has low luminance variance, average colour must also be close because
 * dHash contains little information for flat images.
 *
 * maxAspectRatioDifference is relative to the larger ratio and therefore lies
 * between 0 and 1. maxAverageRgbDistance is Euclidean distance in RGB space.
 * This module intentionally provides no product defaults: thresholds are a
 * retrieval policy and must be selected and recorded by the caller.
 *
 * @param {object} left
 * @param {object} right
 * @param {{maxHammingDistance: number, maxAspectRatioDifference: number, lowVarianceThreshold: number, maxAverageRgbDistance: number}} [thresholds]
 * @returns {object}
 */
function classifySimilarity(left, right, thresholds) {
  const leftSha256 = readOptionalSha256(left, "left");
  const rightSha256 = readOptionalSha256(right, "right");

  if (leftSha256 && rightSha256 && leftSha256 === rightSha256) {
    return freezeClassification({
      classification: "exact",
      isExact: true,
      isCandidate: false,
      requiresReview: false,
      reason: "sha256_match",
      metrics: null,
      checks: Object.freeze({ sha256Match: true }),
      thresholds: null
    });
  }

  const policy = normalizeThresholds(thresholds);
  const leftFingerprint = normalizeFingerprint(left, "left");
  const rightFingerprint = normalizeFingerprint(right, "right");
  const distance = hammingDistance(leftFingerprint.hash, rightFingerprint.hash);
  const aspectRatioDifference = relativeDifference(
    leftFingerprint.aspectRatio,
    rightFingerprint.aspectRatio
  );
  const redDifference = leftFingerprint.averageRgb.r - rightFingerprint.averageRgb.r;
  const greenDifference = leftFingerprint.averageRgb.g - rightFingerprint.averageRgb.g;
  const blueDifference = leftFingerprint.averageRgb.b - rightFingerprint.averageRgb.b;
  const averageRgbDistanceSquared = (
    (redDifference * redDifference)
    + (greenDifference * greenDifference)
    + (blueDifference * blueDifference)
  );
  const averageRgbDistance = Math.sqrt(averageRgbDistanceSquared);
  const hasLowVariance = (
    leftFingerprint.luminanceVariance <= policy.lowVarianceThreshold
    || rightFingerprint.luminanceVariance <= policy.lowVarianceThreshold
  );

  const checks = Object.freeze({
    sha256Match: false,
    hammingDistance: distance <= policy.maxHammingDistance,
    aspectRatio: aspectRatioDifference <= policy.maxAspectRatioDifference,
    lowVarianceColour: (
      !hasLowVariance
      || averageRgbDistanceSquared <= (policy.maxAverageRgbDistance * policy.maxAverageRgbDistance)
    )
  });
  const isCandidate = checks.hammingDistance && checks.aspectRatio && checks.lowVarianceColour;
  const metrics = Object.freeze({
    hammingDistance: distance,
    aspectRatioDifference,
    averageRgbDistance,
    hasLowVariance
  });

  return freezeClassification({
    classification: isCandidate ? "similar_candidate" : "not_candidate",
    isExact: false,
    isCandidate,
    requiresReview: isCandidate,
    reason: isCandidate ? "perceptual_thresholds_met" : "perceptual_thresholds_not_met",
    metrics,
    checks,
    thresholds: policy
  });
}

function validateRgbaInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object containing pixels, width and height.");
  }
  const { pixels, width, height } = input;
  if (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) {
    throw new TypeError("pixels must be a Uint8Array or Uint8ClampedArray containing normalized RGBA bytes.");
  }
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError("width and height must be positive safe integers.");
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    throw new RangeError("image dimensions exceed the supported RGBA length.");
  }
  if (pixels.length !== pixelCount * 4) {
    throw new RangeError("pixels length must equal width * height * 4.");
  }
  return { pixels, width, height, pixelCount };
}

function compositeOnWhite(channel, alpha) {
  return Math.floor(((channel * alpha) + (255 * (255 - alpha)) + 127) / 255);
}

function rgbLuminance(red, green, blue) {
  return Math.floor(((77 * red) + (150 * green) + (29 * blue) + 128) / 256);
}

function roundPositiveRatio(numerator, denominator) {
  return Math.floor((numerator + (denominator / 2)) / denominator);
}

function resampleLuminance(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const xContributors = buildAxisContributors(sourceWidth, targetWidth);
  const yContributors = buildAxisContributors(sourceHeight, targetHeight);
  const result = new Uint8Array(targetWidth * targetHeight);

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const yEntries = yContributors[targetY];
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const xEntries = xContributors[targetX];
      let weightedSum = 0;
      let weightSum = 0;
      for (const yEntry of yEntries) {
        const rowOffset = yEntry.index * sourceWidth;
        for (const xEntry of xEntries) {
          const weight = xEntry.weight * yEntry.weight;
          weightedSum += source[rowOffset + xEntry.index] * weight;
          weightSum += weight;
        }
      }
      result[(targetY * targetWidth) + targetX] = roundPositiveRatio(weightedSum, weightSum);
    }
  }
  return result;
}

function buildAxisContributors(sourceSize, targetSize) {
  const contributors = [];
  if (sourceSize < targetSize) {
    for (let targetIndex = 0; targetIndex < targetSize; targetIndex += 1) {
      const sourceIndex = Math.min(
        sourceSize - 1,
        Math.floor((((2 * targetIndex) + 1) * sourceSize) / (2 * targetSize))
      );
      contributors.push(Object.freeze([{ index: sourceIndex, weight: 1 }]));
    }
    return Object.freeze(contributors);
  }

  // Coordinates are expressed in units of 1 / targetSize, keeping all area
  // overlaps integral and avoiding platform-specific floating interpolation.
  for (let targetIndex = 0; targetIndex < targetSize; targetIndex += 1) {
    const intervalStart = targetIndex * sourceSize;
    const intervalEnd = (targetIndex + 1) * sourceSize;
    const firstSourceIndex = Math.floor(intervalStart / targetSize);
    const lastSourceIndex = Math.ceil(intervalEnd / targetSize) - 1;
    const entries = [];
    for (let sourceIndex = firstSourceIndex; sourceIndex <= lastSourceIndex; sourceIndex += 1) {
      const sourceStart = sourceIndex * targetSize;
      const sourceEnd = sourceStart + targetSize;
      const weight = Math.min(intervalEnd, sourceEnd) - Math.max(intervalStart, sourceStart);
      if (weight > 0) entries.push(Object.freeze({ index: sourceIndex, weight }));
    }
    contributors.push(Object.freeze(entries));
  }
  return Object.freeze(contributors);
}

function normalizeDHash(value, name) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a 16-character hexadecimal dHash.`);
  }
  return value.toLowerCase();
}

function readOptionalSha256(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} fingerprint must be an object.`);
  }
  const candidates = [value.sha256, value.contentSha256]
    .filter((candidate) => candidate !== undefined && candidate !== null && candidate !== "")
    .map((candidate) => String(candidate).trim().toLowerCase());
  if (candidates.length === 0) return null;
  if (candidates.some((candidate) => !SHA256_PATTERN.test(candidate))) {
    throw new TypeError(`${name} SHA-256 must be a 64-character hexadecimal digest.`);
  }
  if (new Set(candidates).size > 1) {
    throw new TypeError(`${name} fingerprint contains conflicting SHA-256 digests.`);
  }
  return candidates[0];
}

function normalizeFingerprint(value, name) {
  if (value.algorithm !== undefined && value.algorithm !== DHASH_ALGORITHM) {
    throw new TypeError(`${name}.algorithm must be ${DHASH_ALGORITHM}.`);
  }
  const averageRgb = normalizeAverageRgb(value.averageRgb, `${name}.averageRgb`);
  return Object.freeze({
    hash: normalizeDHash(value.hash, `${name}.hash`),
    averageRgb,
    luminanceVariance: requireFiniteRange(value.luminanceVariance, `${name}.luminanceVariance`, 0, Infinity),
    aspectRatio: requireFiniteRange(value.aspectRatio, `${name}.aspectRatio`, Number.MIN_VALUE, Infinity)
  });
}

function normalizeAverageRgb(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object with integer r, g and b channels.`);
  }
  const output = {};
  for (const channel of ["r", "g", "b"]) {
    if (!Number.isInteger(value[channel]) || value[channel] < 0 || value[channel] > 255) {
      throw new RangeError(`${name}.${channel} must be an integer from 0 to 255.`);
    }
    output[channel] = value[channel];
  }
  return Object.freeze(output);
}

function normalizeThresholds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("thresholds must be supplied by the caller.");
  }
  return Object.freeze({
    maxHammingDistance: requireIntegerRange(value.maxHammingDistance, "maxHammingDistance", 0, 64),
    maxAspectRatioDifference: requireFiniteRange(
      value.maxAspectRatioDifference,
      "maxAspectRatioDifference",
      0,
      1
    ),
    lowVarianceThreshold: requireFiniteRange(
      value.lowVarianceThreshold,
      "lowVarianceThreshold",
      0,
      255 * 255
    ),
    maxAverageRgbDistance: requireFiniteRange(
      value.maxAverageRgbDistance,
      "maxAverageRgbDistance",
      0,
      MAX_RGB_DISTANCE
    )
  });
}

function requireIntegerRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function requireFiniteRange(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function relativeDifference(left, right) {
  return Math.abs(left - right) / Math.max(left, right);
}

function freezeClassification(value) {
  return Object.freeze(value);
}

module.exports = {
  DHASH_ALGORITHM,
  computeDHash64,
  hammingDistance,
  classifySimilarity
};
