/**
 * ieee754-core.js
 * ----------------
 * Exact, dependency-free engine for IEEE 754 binary32 (single precision)
 * conversion, rounding demonstration, and arithmetic (add / multiply).
 *
 * Design notes:
 *  - Decimal input is parsed into an EXACT BigInt fraction (numerator/denominator),
 *    so there is no precision loss from JS's native double parsing before we
 *    do our own binary conversion. This lets us support arbitrary rounding
 *    modes correctly instead of relying on whatever rounding `Number()` did.
 *  - Binary expansion of the fraction is generated bit-by-bit via long
 *    division on BigInts, which is exact even for repeating binary fractions
 *    (e.g. 0.1 decimal). We keep a "sticky" flag = OR of all further bits.
 *  - Rounding modes implemented: chop (truncate / round toward zero),
 *    round up (toward +Infinity), round down (toward -Infinity),
 *    and round to nearest, ties to even (the IEEE 754 default).
 */

const BIAS = 127;
const MANTISSA_BITS = 23;
const EXP_BITS = 8;

// ---------------------------------------------------------------------
// Decimal string -> exact BigInt fraction {sign, num, den}
// ---------------------------------------------------------------------
function parseDecimalToFraction(str) {
  str = str.trim();
  let sign = 1;
  if (str.startsWith('-')) { sign = -1; str = str.slice(1); }
  else if (str.startsWith('+')) { str = str.slice(1); }

  let expPart = 0;
  const eMatch = str.match(/[eE]([+-]?\d+)$/);
  if (eMatch) {
    expPart = parseInt(eMatch[1], 10);
    str = str.slice(0, eMatch.index);
  }

  if (!/^\d*\.?\d*$/.test(str) || str === '' || str === '.') {
    throw new Error(`Invalid decimal number: "${str}"`);
  }

  let [intPart, fracPart = ''] = str.split('.');
  if (intPart === '') intPart = '0';

  let num = BigInt(intPart + fracPart || '0');
  let den = 10n ** BigInt(fracPart.length);

  if (expPart > 0) num *= 10n ** BigInt(expPart);
  else if (expPart < 0) den *= 10n ** BigInt(-expPart);

  return { sign, num, den };
}

// Is num/den >= 2^e ?  (e may be negative)
function geP2(num, den, e) {
  if (e >= 0) return num >= den * (2n ** BigInt(e));
  return num * (2n ** BigInt(-e)) >= den;
}

/**
 * Normalize an exact fraction num/den (num, den > 0) into
 * { e, bits, remainderNonZero } where:
 *   value = 1.bits[0]bits[1]... x 2^e   (1 <= value/2^e < 2)
 * `bits` has `count` bits generated via exact long division.
 * `remainderNonZero` tells us whether there are any nonzero bits beyond
 * the ones generated (the "sticky" bit source).
 */
function normalizeFraction(num, den, bitCount) {
  if (num === 0n) return { e: 0, bits: new Array(bitCount).fill(0), remainderNonZero: false, isZero: true };

  // Estimate exponent using floating point log2, then correct exactly.
  let e = Math.floor(Math.log2(Number(num) / Number(den)));
  if (!isFinite(e)) {
    // Fallback for extreme magnitudes where Number() overflows/underflows:
    // walk digit-by-digit using bit length comparisons.
    e = 0;
    while (!geP2(num, den, e)) e--;
    while (geP2(num, den, e + 1)) e++;
  } else {
    while (!geP2(num, den, e)) e--;
    while (geP2(num, den, e + 1)) e++;
  }

  // A/B = value / 2^e, normalized so 1 <= A/B < 2
  let A, B;
  if (e >= 0) { A = num; B = den * (2n ** BigInt(e)); }
  else { A = num * (2n ** BigInt(-e)); B = den; }

  let r = A - B; // remainder after implicit leading 1
  const bits = [];
  for (let i = 0; i < bitCount; i++) {
    r *= 2n;
    if (r >= B) { bits.push(1); r -= B; }
    else bits.push(0);
  }
  return { e, bits, remainderNonZero: r !== 0n, isZero: false };
}

// ---------------------------------------------------------------------
// Rounding: given `bits` (mantissa candidate bits, length >= MANTISSA_BITS+2)
// and `remainderNonZero` (sticky beyond generated bits), round to
// MANTISSA_BITS using the requested mode. Returns { mantissaBits, carry }
// where carry=true means the mantissa overflowed (all 1s -> rounds up to
// 1.000..0 x 2^(e+1)).
// ---------------------------------------------------------------------
function roundMantissa(bits, remainderNonZero, mode, sign) {
  const kept = bits.slice(0, MANTISSA_BITS);
  const guard = bits[MANTISSA_BITS] || 0;
  const round = bits[MANTISSA_BITS + 1] || 0;
  const stickyRest = bits.slice(MANTISSA_BITS + 2).some(b => b === 1) || remainderNonZero;
  const sticky = round === 1 || stickyRest ? 1 : 0; // combined "any 1s after guard"
  const anyBeyondGuard = round === 1 || stickyRest;

  let roundUp = false;
  switch (mode) {
    case 'chop': // truncate toward zero
      roundUp = false;
      break;
    case 'up': // toward +Infinity
      roundUp = (sign === 1) && (guard === 1 || anyBeyondGuard);
      break;
    case 'down': // toward -Infinity
      roundUp = (sign === -1) && (guard === 1 || anyBeyondGuard);
      break;
    case 'nearest_even':
    default:
      if (guard === 0) roundUp = false;
      else if (anyBeyondGuard) roundUp = true; // > halfway
      else roundUp = kept[MANTISSA_BITS - 1] === 1; // exact tie -> round to even
      break;
  }

  if (!roundUp) return { mantissaBits: kept, carry: false };

  // increment the 23-bit mantissa as a binary number
  let carry = 1;
  const result = kept.slice();
  for (let i = MANTISSA_BITS - 1; i >= 0 && carry; i--) {
    if (result[i] === 1) { result[i] = 0; }
    else { result[i] = 1; carry = 0; }
  }
  return { mantissaBits: result, carry: carry === 1 };
}

// ---------------------------------------------------------------------
// Full decimal -> binary32 field encoder (with selectable rounding mode,
// default = nearest_even, the IEEE 754 default for conversions).
// ---------------------------------------------------------------------
function decimalToFields(decimalStr, mode = 'nearest_even') {
  const trimmed = decimalStr.trim().toLowerCase();

  // Special-case literals
  if (trimmed === 'nan' || trimmed === '-nan') return specialFields('nan');
  if (trimmed === 'inf' || trimmed === 'infinity' || trimmed === '+inf' || trimmed === '+infinity') return specialFields('+inf');
  if (trimmed === '-inf' || trimmed === '-infinity') return specialFields('-inf');

  const { sign, num, den } = parseDecimalToFraction(decimalStr);

  if (num === 0n) {
    return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -BIAS, steps: [`Value is zero -> exponent = 0, mantissa = 0.`] };
  }

  // Generate plenty of extra bits (guard/round/sticky region) exactly.
  const EXTRA = 8;
  const { e, bits, remainderNonZero } = normalizeFraction(num, den, MANTISSA_BITS + EXTRA);

  const steps = [];
  steps.push(`Parsed exact value as a fraction and normalized: 1.${bits.slice(0, 12).join('')}... x 2^${e}`);

  // Overflow check (before rounding, using exponent only is a good first pass)
  if (e > 127 + 1) { // generous; refined after rounding-carry check below
    return specialFields(sign === -1 ? '-inf' : '+inf', [...steps, `Exponent ${e} exceeds max representable range -> overflow to Infinity.`]);
  }

  // Underflow to subnormal / zero range: unbiased exponent < -126
  if (e < -126) {
    // Subnormal path: shift mantissa right so effective exponent is -126,
    // padding with leading zeros, then round.
    const shift = -126 - e; // how many extra positions to shift right
    if (shift >= MANTISSA_BITS + EXTRA) {
      steps.push(`Magnitude far smaller than smallest subnormal -> rounds to zero.`);
      return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -BIAS, steps };
    }
    const shifted = new Array(shift).fill(0).concat(bits).slice(0, MANTISSA_BITS + EXTRA);
    const { mantissaBits, carry } = roundMantissa(shifted, remainderNonZero, mode, sign);
    steps.push(`Value smaller than 2^-126 -> encoded as a subnormal, shifting mantissa right by ${shift} bit(s).`);
    if (carry) {
      // Rounds up into the smallest normal number
      return { sign: sign === -1 ? 1 : 0, exponentBits: 1, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -126, steps: [...steps, `Rounding carried out of subnormal range -> becomes smallest normal number.`] };
    }
    return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits, special: null, unbiasedExp: -BIAS, steps };
  }

  const { mantissaBits, carry } = roundMantissa(bits, remainderNonZero, mode, sign);
  let finalExp = e;
  let finalMantissa = mantissaBits;
  if (carry) {
    finalExp = e + 1;
    finalMantissa = new Array(MANTISSA_BITS).fill(0);
    steps.push(`Rounding caused mantissa overflow -> exponent incremented to ${finalExp}.`);
  }

  if (finalExp > 127) {
    return specialFields(sign === -1 ? '-inf' : '+inf', [...steps, `Rounded exponent ${finalExp} exceeds max (127) -> overflow to Infinity.`]);
  }

  const exponentBits = finalExp + BIAS;
  steps.push(`Rounded mantissa: ${finalMantissa.join('')}, biased exponent = ${finalExp} + 127 = ${exponentBits}.`);

  return { sign: sign === -1 ? 1 : 0, exponentBits, mantissaBits: finalMantissa, special: null, unbiasedExp: finalExp, steps };
}

function specialFields(kind, steps = []) {
  if (kind === 'nan') {
    return { sign: 0, exponentBits: 255, mantissaBits: [1, ...new Array(22).fill(0)], special: 'NaN', unbiasedExp: null, steps: [...steps, 'Encoded as NaN: exponent all 1s, nonzero mantissa.'] };
  }
  if (kind === '+inf') {
    return { sign: 0, exponentBits: 255, mantissaBits: new Array(23).fill(0), special: '+Infinity', unbiasedExp: null, steps: [...steps, 'Encoded as +Infinity: exponent all 1s, mantissa zero.'] };
  }
  if (kind === '-inf') {
    return { sign: 1, exponentBits: 255, mantissaBits: new Array(23).fill(0), special: '-Infinity', unbiasedExp: null, steps: [...steps, 'Encoded as -Infinity: sign=1, exponent all 1s, mantissa zero.'] };
  }
}

// ---------------------------------------------------------------------
// Field <-> binary string / hex string helpers
// ---------------------------------------------------------------------
function fieldsToBits32(fields) {
  return [fields.sign, ...intToBits(fields.exponentBits, EXP_BITS), ...fields.mantissaBits];
}

function intToBits(n, width) {
  const bits = [];
  for (let i = width - 1; i >= 0; i--) bits.push((n >> i) & 1);
  return bits;
}

function bitsToSpacedBinary(bits) {
  const s = bits[0];
  const e = bits.slice(1, 9).join('');
  const m = bits.slice(9).join('');
  return `${s} ${e} ${m}`;
}

function bitsToHex(bits) {
  const bin = bits.join('');
  let hex = '';
  for (let i = 0; i < 32; i += 4) {
    hex += parseInt(bin.slice(i, i + 4), 2).toString(16);
  }
  return '0x' + hex.toUpperCase();
}

function hexToBits32(hexStr) {
  let h = hexStr.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,8}$/.test(h)) throw new Error(`Invalid hex value: "${hexStr}"`);
  h = h.padStart(8, '0');
  let bin = '';
  for (const c of h) bin += parseInt(c, 16).toString(2).padStart(4, '0');
  return bin.split('').map(Number);
}

function bitsToFields(bits) {
  const sign = bits[0];
  const exponentBits = parseInt(bits.slice(1, 9).join(''), 2);
  const mantissaBits = bits.slice(9);
  let special = null;
  if (exponentBits === 255) {
    special = mantissaBits.some(b => b === 1) ? 'NaN' : (sign ? '-Infinity' : '+Infinity');
  }
  const unbiasedExp = exponentBits === 0 ? -126 : exponentBits - BIAS;
  return { sign, exponentBits, mantissaBits, special, unbiasedExp };
}

// Exact decimal value of a set of fields, expressed as a fraction, then
// rendered to a readable decimal string (may include repeating-decimal
// truncation notice for irrational-in-base-10 binary fractions... in
// practice base-2 fractions always terminate in base 10, so this is exact).
function fieldsToDecimalString(fields) {
  if (fields.special) return fields.special;
  const signMul = fields.sign ? -1n : 1n;
  let mantissaNum = 0n;
  for (let i = 0; i < MANTISSA_BITS; i++) mantissaNum = mantissaNum * 2n + BigInt(fields.mantissaBits[i]);

  if (fields.exponentBits === 0) {
    // subnormal: value = mantissa/2^23 * 2^-126
    if (mantissaNum === 0n) return fields.sign ? '-0' : '0';
    return bigFractionToDecimal(signMul * mantissaNum, 2n ** BigInt(23 + 126));
  }
  const e = fields.exponentBits - BIAS;
  // value = 1.mantissa * 2^e = (2^23 + mantissaNum) / 2^23 * 2^e
  const numerator = signMul * (2n ** 23n + mantissaNum);
  if (e >= 0) {
    return bigFractionToDecimal(numerator * (2n ** BigInt(e)), 2n ** 23n);
  } else {
    return bigFractionToDecimal(numerator, 2n ** BigInt(23 - e));
  }
}

// Render an exact BigInt fraction (num/den, den a power of 2) as a decimal
// string. Since den is a power of 2, num/den always terminates in base 10.
function bigFractionToDecimal(num, den) {
  const neg = num < 0n;
  if (neg) num = -num;
  const intPart = num / den;
  let rem = num % den;
  if (rem === 0n) return (neg ? '-' : '') + intPart.toString();
  let frac = '';
  // Multiply remainder by 10 each step; since den is a power of 2, this
  // terminates in at most ~ (bits of den) decimal digits.
  let guard = 0;
  while (rem !== 0n && guard < 60) {
    rem *= 10n;
    frac += (rem / den).toString();
    rem = rem % den;
    guard++;
  }
  return (neg ? '-' : '') + intPart.toString() + '.' + frac;
}

// ---------------------------------------------------------------------
// Public: decimal -> full representation
// ---------------------------------------------------------------------
function convertDecimal(decimalStr) {
  const fields = decimalToFields(decimalStr, 'nearest_even');
  const bits = fieldsToBits32(fields);
  return {
    binary: bitsToSpacedBinary(bits),
    hex: bitsToHex(bits),
    fields,
    decimalEcho: fieldsToDecimalString(fields),
  };
}

function convertHexToDecimal(hexStr) {
  const bits = hexToBits32(hexStr);
  const fields = bitsToFields(bits);
  return {
    binary: bitsToSpacedBinary(bits),
    hex: bitsToHex(bits),
    fields,
    decimal: fieldsToDecimalString(fields),
  };
}

// ---------------------------------------------------------------------
// Rounding demonstration (part 2): take a decimal or binary-fraction
// input plus a target bit/digit count, and show all four methods.
// ---------------------------------------------------------------------
function demonstrateRounding(inputStr, inputKind, targetBits) {
  let sign = 1, num, den;
  if (inputKind === 'decimal') {
    ({ sign, num, den } = parseDecimalToFraction(inputStr));
  } else {
    // binary fraction like "1.01101" or "0.1011"
    const s = inputStr.trim();
    let str = s;
    if (str.startsWith('-')) { sign = -1; str = str.slice(1); }
    if (!/^[01]*\.?[01]*$/.test(str) || str === '' || str === '.') throw new Error('Invalid binary number');
    const [ip = '0', fp = ''] = str.split('.');
    num = BigInt(parseInt(ip || '0', 2)) * (2n ** BigInt(fp.length)) + (fp ? BigInt(parseInt(fp, 2)) : 0n);
    den = 2n ** BigInt(fp.length);
  }

  if (num === 0n) {
    const zeroBits = new Array(targetBits).fill(0).join('');
    return ['chop', 'up', 'down', 'nearest_even'].reduce((acc, m) => { acc[m] = { bits: zeroBits, exp: 0 }; return acc; }, {});
  }

  const { e, bits, remainderNonZero } = normalizeFraction(num, den, targetBits + 8);
  const results = {};
  for (const mode of ['chop', 'up', 'down', 'nearest_even']) {
    const kept = bits.slice(0, targetBits);
    const guard = bits[targetBits] || 0;
    const stickyRest = bits.slice(targetBits + 1).some(b => b === 1) || remainderNonZero;
    let roundUp = false;
    switch (mode) {
      case 'chop': roundUp = false; break;
      case 'up': roundUp = sign === 1 && (guard === 1 || stickyRest); break;
      case 'down': roundUp = sign === -1 && (guard === 1 || stickyRest); break;
      case 'nearest_even':
        if (guard === 0) roundUp = false;
        else if (stickyRest) roundUp = true;
        else roundUp = kept[targetBits - 1] === 1;
        break;
    }
    let resultBits = kept.slice();
    let exp = e;
    if (roundUp) {
      let carry = 1;
      for (let i = targetBits - 1; i >= 0 && carry; i--) {
        if (resultBits[i] === 1) resultBits[i] = 0;
        else { resultBits[i] = 1; carry = 0; }
      }
      if (carry) { exp += 1; resultBits = new Array(targetBits).fill(0); }
    }
    results[mode] = { bits: (sign === -1 ? '-' : '') + '1.' + resultBits.join(''), exp };
  }
  return results;
}

// ---------------------------------------------------------------------
// Arithmetic: addition and multiplication with a selectable rounding mode.
// Operands may be given as decimal strings or IEEE hex strings.
// ---------------------------------------------------------------------
function parseOperand(str, kind) {
  if (kind === 'hex') {
    const bits = hexToBits32(str);
    return bitsToFields(bits);
  }
  return decimalToFields(str, 'nearest_even'); // exact binary32 value of the literal, for display purposes
}

// Get the *exact* value of an operand as a signed BigInt fraction (num/den),
// re-deriving it from its own decimal parse (exact) so that arithmetic
// isn't pre-rounded twice. For hex input, the field bits ARE the exact value.
function operandToExactFraction(str, kind) {
  if (kind === 'hex') {
    const bits = hexToBits32(str);
    const fields = bitsToFields(bits);
    if (fields.special) return { special: fields.special, fields };
    const signMul = fields.sign ? -1n : 1n;
    let mantissaNum = 0n;
    for (let i = 0; i < MANTISSA_BITS; i++) mantissaNum = mantissaNum * 2n + BigInt(fields.mantissaBits[i]);
    if (fields.exponentBits === 0) {
      if (mantissaNum === 0n) return { num: 0n, den: 1n, fields };
      return { num: signMul * mantissaNum, den: 2n ** BigInt(23 + 126), fields };
    }
    const e = fields.exponentBits - BIAS;
    const numerator = signMul * (2n ** 23n + mantissaNum);
    if (e >= 0) return { num: numerator * (2n ** BigInt(e)), den: 2n ** 23n, fields };
    return { num: numerator, den: 2n ** BigInt(23 - e), fields };
  } else {
    const trimmed = str.trim().toLowerCase();
    if (['nan', '-nan'].includes(trimmed)) return { special: 'NaN', fields: specialFields('nan') };
    if (['inf', 'infinity', '+inf', '+infinity'].includes(trimmed)) return { special: '+Infinity', fields: specialFields('+inf') };
    if (['-inf', '-infinity'].includes(trimmed)) return { special: '-Infinity', fields: specialFields('-inf') };
    const { sign, num, den } = parseDecimalToFraction(str);
    return { num: BigInt(sign) * num, den, fields: decimalToFields(str) };
  }
}

function fractionToRoundedFields(num, den, mode) {
  // num may be negative, den > 0
  const sign = num < 0n ? -1 : 1;
  if (num < 0n) num = -num;
  if (num === 0n) return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -BIAS };

  const { e, bits, remainderNonZero } = normalizeFraction(num, den, MANTISSA_BITS + 8);

  if (e < -126) {
    const shift = -126 - e;
    if (shift >= MANTISSA_BITS + 8) return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -BIAS };
    const shifted = new Array(shift).fill(0).concat(bits).slice(0, MANTISSA_BITS + 8);
    const { mantissaBits, carry } = roundMantissa(shifted, remainderNonZero, mode, sign);
    if (carry) return { sign: sign === -1 ? 1 : 0, exponentBits: 1, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -126 };
    return { sign: sign === -1 ? 1 : 0, exponentBits: 0, mantissaBits, special: null, unbiasedExp: -BIAS };
  }

  const { mantissaBits, carry } = roundMantissa(bits, remainderNonZero, mode, sign);
  let finalExp = e, finalMantissa = mantissaBits;
  if (carry) { finalExp = e + 1; finalMantissa = new Array(MANTISSA_BITS).fill(0); }
  if (finalExp > 127) return specialFields(sign === -1 ? '-inf' : '+inf');
  return { sign: sign === -1 ? 1 : 0, exponentBits: finalExp + BIAS, mantissaBits: finalMantissa, special: null, unbiasedExp: finalExp };
}

function arithmetic(aStr, aKind, bStr, bKind, op, mode) {
  const steps = [];
  const A = operandToExactFraction(aStr, aKind);
  const B = operandToExactFraction(bStr, bKind);

  const describeOperand = (label, str, kind, x) => {
    const f = x.fields;
    const bits = fieldsToBits32(f);
    steps.push(`${label} = ${str} (${kind}) -> binary: ${bitsToSpacedBinary(bits)}  |  hex: ${bitsToHex(bits)}`);
  };
  describeOperand('Operand A', aStr, aKind, A);
  describeOperand('Operand B', bStr, bKind, B);

  // --- Special-case handling per IEEE 754 rules ---
  const isNaN_ = x => x.special === 'NaN';
  const isInf = x => x.special === '+Infinity' || x.special === '-Infinity';
  const infSign = x => x.special === '-Infinity' ? -1 : 1;

  if (isNaN_(A) || isNaN_(B)) {
    steps.push('One operand is NaN -> result is NaN (IEEE 754 propagation rule).');
    return finishSpecial('NaN', steps);
  }

  if (op === 'add') {
    if (isInf(A) && isInf(B)) {
      if (infSign(A) !== infSign(B)) {
        steps.push('Infinity + (-Infinity) is an indeterminate form -> result is NaN.');
        return finishSpecial('NaN', steps);
      }
      steps.push(`Infinity + Infinity of the same sign -> result is ${infSign(A) === -1 ? '-Infinity' : '+Infinity'}.`);
      return finishSpecial(infSign(A) === -1 ? '-Infinity' : '+Infinity', steps);
    }
    if (isInf(A)) { steps.push('Operand A is infinite -> sum is that same Infinity.'); return finishSpecial(A.special, steps); }
    if (isInf(B)) { steps.push('Operand B is infinite -> sum is that same Infinity.'); return finishSpecial(B.special, steps); }
  } else {
    if (isInf(A) || isInf(B)) {
      const aZero = !isInf(A) && A.num === 0n;
      const bZero = !isInf(B) && B.num === 0n;
      if (aZero || bZero) {
        steps.push('Infinity multiplied by zero is an indeterminate form -> result is NaN.');
        return finishSpecial('NaN', steps);
      }
      const rs = (isInf(A) ? infSign(A) : (A.num < 0n ? -1 : 1)) * (isInf(B) ? infSign(B) : (B.num < 0n ? -1 : 1));
      steps.push(`One operand is infinite -> product is ${rs === -1 ? '-Infinity' : '+Infinity'}.`);
      return finishSpecial(rs === -1 ? '-Infinity' : '+Infinity', steps);
    }
  }

  function finishSpecial(kind, steps) {
    const fields = kind === 'NaN' ? specialFields('nan') : specialFields(kind === '-Infinity' ? '-inf' : '+inf');
    const bits = fieldsToBits32(fields);
    return { steps, binary: bitsToSpacedBinary(bits), hex: bitsToHex(bits), decimal: kind, fields };
  }

  // --- Normal path: exact rational arithmetic, then round once at the end ---
  let resultNum, resultDen;
  if (op === 'add') {
    resultNum = A.num * B.den + B.num * A.den;
    resultDen = A.den * B.den;
    steps.push(`Aligning exponents and adding significands exactly: (${A.num}/${A.den}) + (${B.num}/${B.den}) = ${resultNum}/${resultDen} (exact, pre-rounding).`);
  } else {
    resultNum = A.num * B.num;
    resultDen = A.den * B.den;
    steps.push(`Multiplying significands exactly: (${A.num}/${A.den}) x (${B.num}/${B.den}) = ${resultNum}/${resultDen} (exact, pre-rounding).`);
  }

  // reduce fraction a bit to keep BigInts smaller (optional, gcd via Euclid)
  const g = gcdBig(resultNum < 0n ? -resultNum : resultNum, resultDen);
  if (g > 1n) { resultNum /= g; resultDen /= g; }

  if (resultNum === 0n) {
    steps.push('Exact result is zero.');
    const fields = { sign: 0, exponentBits: 0, mantissaBits: new Array(23).fill(0), special: null, unbiasedExp: -BIAS };
    const bits = fieldsToBits32(fields);
    return { steps, binary: bitsToSpacedBinary(bits), hex: bitsToHex(bits), decimal: '0', fields };
  }

  const fields = fractionToRoundedFields(resultNum, resultDen, mode);
  steps.push(`Rounding the exact result to 23 mantissa bits using "${modeLabel(mode)}".`);
  const bits = fieldsToBits32(fields);
  const decimalResult = fieldsToDecimalString(fields);
  steps.push(`Final rounded result: binary ${bitsToSpacedBinary(bits)}, hex ${bitsToHex(bits)}, decimal ${decimalResult}.`);

  return { steps, binary: bitsToSpacedBinary(bits), hex: bitsToHex(bits), decimal: decimalResult, fields };
}

function gcdBig(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

function modeLabel(mode) {
  return { chop: 'Chopping (truncate)', up: 'Round toward +Infinity', down: 'Round toward -Infinity', nearest_even: 'Round to nearest, ties to even' }[mode] || mode;
}

// Exposed API
window.IEEE754 = {
  convertDecimal,
  convertHexToDecimal,
  demonstrateRounding,
  arithmetic,
  modeLabel,
};
