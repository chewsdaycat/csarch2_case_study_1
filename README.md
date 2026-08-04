# MACHINE 2: Binary 32-bit Floating-Point Machine
**ALONTO, CHOA, CHUA, LABORADA**

## Video Link: https://youtu.be/HNhtuTmR3SY

A browser-based IEEE 754 binary32 toolkit that lets users convert decimal/hex values into their floating-point representation, compare the four IEEE rounding modes side by side, and perform binary32 addition and multiplication with each step of the underlying bit-level math shown explicitly.

## File Structure

```
csarch2_case_study_1/
├── index.html          # landing page, links to the 3 tools
├── convert.html
├── convert.js
├── rounding.html
├── rounding.js
├── arithmetic.html
├── arithmetic.js
├── style.css            # shared styling + nav bar
├── ieee754-core.js       # shared math engine (unchanged)
├── vercel.json
└── README.md
```

---

## BigInt Conversion (Decimal/Hex → BigInt)

Before any IEEE 754 encoding/decoding happens, both decimal and hexadecimal inputs are first converted into JavaScript `BigInt` values. This is done because standard JS numbers are IEEE 754 doubles themselves and lose precision on raw 32-bit bit manipulation (shifts, masks) once you approach the edges of the safe integer range — using `BigInt` guarantees exact, lossless integer arithmetic while assembling/disassembling the sign, exponent, and mantissa fields.

- **Decimal → BigInt:** the decimal string is parsed and split into integer and fractional parts. The integer part is converted directly via `BigInt(Math.trunc(value))`. Once the value's binary32 fields (sign, exponent, mantissa) are computed, the individual field values are combined into a single 32-bit pattern using `BigInt` bitwise operators (`<<`, `|`), which avoids the 32-bit signed overflow behavior of native JS bitwise operators (which internally coerce to `Int32`).
- **Hex → BigInt:** the hex string (e.g. `"0x3F800000"`) is passed directly to `BigInt("0x3F800000")`, giving an exact 32-bit unsigned integer. This value is then masked and shifted with `BigInt` operations to extract the sign (1 bit), exponent (8 bits), and mantissa (23 bits) fields without any precision loss.
- **BigInt → binary/hex string (for display):** the resulting `BigInt` is converted back with `.toString(2)` (binary) or `.toString(16)` (hex), then zero-padded to the expected field width (32 bits for the full pattern, 8 for exponent, 23 for mantissa) since `.toString()` on `BigInt` drops leading zeros.

Using `BigInt` throughout keeps the bit-level assembly/disassembly of the 32-bit pattern exact and independent of JavaScript's native `Number` precision limits, which matters since the whole point of the tool is to demonstrate precision behavior — the tool itself shouldn't introduce precision bugs of its own.

---

## Conversion Module

### IEEE 754 Step-by-Step Procedure

**Decimal → Binary32:**
1. **Determine the sign bit.** 0 for positive, 1 for negative.
2. **Convert the absolute value to binary.** Convert the integer part using repeated division by 2; convert the fractional part using repeated multiplication by 2.
3. **Normalize.** Shift the binary point so the number is in the form `1.mantissa × 2^exponent` (one nonzero digit before the point).
4. **Bias the exponent.** Add the bias (127 for single precision) to the true exponent to get the stored exponent field (8 bits).
5. **Extract the mantissa.** Take the 23 bits after the leading `1.` (the leading 1 is implicit and not stored). Pad or truncate to 23 bits.
6. **Assemble the fields.** `[1 sign bit][8 exponent bits][23 mantissa bits]` → convert to hex for display.
7. **Handle special cases.** Zero (all exponent/mantissa bits 0), infinity (exponent all 1s, mantissa 0), NaN (exponent all 1s, mantissa nonzero), and subnormals (exponent all 0s, implicit leading bit is 0 instead of 1).

**Hex → Decimal (reverse direction):**
1. Split the 32-bit pattern into sign (1 bit), exponent (8 bits), mantissa (23 bits).
2. Un-bias the exponent: `true_exponent = stored_exponent - 127`.
3. Reconstruct the value: `(-1)^sign × 1.mantissa × 2^true_exponent`.
4. Check for special-case bit patterns before applying the formula (zero, ±infinity, NaN, subnormal).

### Test Cases

| # | Input | Kind | Expected Binary | Expected Hex | Notes |
|---|-------|------|------------------|---------------|-------|
| 1 | `0` | decimal | `0 00000000 00000000000000000000000` | `0x00000000` | Positive zero |
| 2 | `-0` | decimal | `1 00000000 00000000000000000000000` | `0x80000000` | Negative zero |
| 3 | `1` | decimal | `0 01111111 00000000000000000000000` | `0x3F800000` | Exact power-of-two case |
| 4 | `-6.25` | decimal | `1 10000001 10010000000000000000000` | `0xC0C80000` | Simple negative fraction |
| 5 | `0.1` | decimal | `0 01111011 10011001100110011001101` | `0x3DCCCCCD` | Non-terminating binary fraction — tests rounding on conversion |
| 6 | `3.4028235e38` | decimal | — | `0x7F7FFFFF` | Near max representable finite value |
| 7 | `Infinity` | decimal | `0 11111111 00000000000000000000000` | `0x7F800000` | Special case |
| 8 | `NaN` | decimal | `x 11111111 nonzero` | e.g. `0x7FC00000` | Special case |
| 9 | `0x00000001` | hex | — | — | Smallest positive subnormal |
| 10 | `0x7F800000` | hex | — | — | Reverse-direction check: should decode to +Infinity |

---

## Rounding Module

### IEEE 754 Step-by-Step Procedure

IEEE 754 defines four standard rounding modes, applied when a value's true mantissa has more bits than the target format can store:

1. **Round toward zero (chopping/truncation).** Discard all bits beyond the target width. No adjustment.
2. **Round toward +∞ (round up).** If any discarded bits are nonzero, round the result up to the next representable value in the direction of positive infinity. Negative numbers effectively truncate toward zero.
3. **Round toward −∞ (round down).** If any discarded bits are nonzero, round the result down toward negative infinity. Positive numbers effectively truncate toward zero.
4. **Round to nearest, ties to even (default IEEE mode).**
   - Look at the guard bit (first discarded bit), round bit (second), and sticky bit (OR of all remaining discarded bits).
   - If guard bit = 0 → round down (truncate).
   - If guard bit = 1 and (round bit or sticky bit is 1) → round up.
   - If guard bit = 1 and round/sticky bits are all 0 (exact tie) → round to whichever result has an even (0) least-significant retained bit.

Each mode is applied to the same input mantissa/exponent pair so the four results can be compared side by side.

### Test Cases

| # | Input | Target Mantissa Bits | Chop | Round Up | Round Down | Round Nearest (Ties to Even) |
|---|-------|----------------------|------|----------|------------|-------------------------------|
| 1 | `1.10110\|1` (exact tie, LSB retained = 0) | 5 | truncates | rounds up | truncates | rounds down (stays even) |
| 2 | `1.10111\|1` (exact tie, LSB retained = 1) | 5 | truncates | rounds up | truncates | rounds up (becomes even) |
| 3 | `1.1011\|011` (guard=0) | 4 | same as all modes | same | same | same — no rounding needed |
| 4 | `1.1011\|101` (guard=1, sticky=1) | 4 | truncates | rounds up | truncates | rounds up |
| 5 | Negative value with nonzero discarded bits | 4 | truncates toward zero | truncates toward zero | rounds away from zero | depends on guard/round/sticky |
| 6 | `0.1` decimal converted to 10 mantissa bits | 10 | shows underestimate | shows overestimate | shows underestimate | closest representable value |

*(Fill in the exact bit patterns your `demonstrateRounding()` function outputs for each case — the table above defines what each column should demonstrate.)*

---

## Arithmetic Module

### IEEE 754 Step-by-Step Procedure

**Addition/Subtraction:**
1. **Align exponents.** Compare the two exponents; shift the mantissa of the smaller-exponent operand right until both exponents match, appending guard/round/sticky bits to preserve precision.
2. **Add or subtract the aligned mantissas** (accounting for sign — subtraction if signs differ).
3. **Normalize the result.** Shift left or right so the leading bit is 1, adjusting the exponent accordingly.
4. **Round** the normalized result to the target mantissa width using round-to-nearest-even (see Rounding Module).
5. **Check for overflow/underflow** and re-encode into the sign/exponent/mantissa fields.

**Multiplication:**
1. **XOR the sign bits** to get the result sign.
2. **Add the (unbiased) exponents**, then re-bias once (subtract one bias since biasing was applied to both operands).
3. **Multiply the mantissas** (with implicit leading 1s included) as fixed-point numbers.
4. **Normalize** — a product of two `1.x` mantissas falls in `[1, 4)`, so at most a 1-bit shift is needed.
5. **Round** to the target mantissa width.
6. **Check for overflow/underflow** and re-encode into IEEE 754 fields.

### Test Cases

| # | A | B | Operation | Expected Result | Notes |
|---|---|---|-----------|------------------|-------|
| 1 | `1.5` | `2.25` | add | `3.75` | Simple case, no alignment shift needed |
| 2 | `1.5` | `2.25` | multiply | `3.375` | Simple case |
| 3 | `100000` | `0.0001` | add | ≈`100000.0001` (may round to `100000` if precision lost) | Tests exponent alignment / precision loss |
| 4 | `5` | `-5` | add | `0` (positive zero) | Cancellation case |
| 5 | `-3.5` | `2` | add | `-1.5` | Mixed-sign addition (behaves as subtraction) |
| 6 | `0` | `5` | multiply | `0` | Zero-operand case |
| 7 | `0x7F800000` (+Inf) | `2` | multiply | `0x7F800000` (+Inf) | Special-case propagation |
| 8 | `0x7F800000` (+Inf) | `0xFF800000` (-Inf) | add | `0x7FC00000` (NaN) | Invalid operation (∞ + (−∞)) |
| 9 | `3.4028235e38` | `2` | multiply | `Infinity` | Overflow case |
| 10 | `1.0000001` | `1.0000002` | multiply | rounds per nearest-even | Tests rounding after multiply |

---

## Libraries Used

This project intentionally uses **no external JavaScript libraries or frameworks**.  It is built entirely with vanilla HTML, CSS, and JavaScript, plus a custom-written math engine (`ieee754-core.js`).

| Component | Choice | Justification |
|---|---|---|
| Core logic | Vanilla JS (`ieee754-core.js`, custom-built) | IEEE 754 conversion, rounding, and arithmetic are the actual subject being demonstrated. Using a third-party bignum or floating-point library (e.g., `decimal.js`) would hide the bit-level operations the case study requires us to show, so sign/exponent/mantissa manipulation is implemented manually with native JS bitwise operators and typed arrays (`DataView`/`ArrayBuffer`) where needed. |
| DOM/UI | Vanilla JS (no React/Vue/jQuery) | The UI only needs simple event listeners and text updates per module; a framework would add build tooling and overhead disproportionate to the app's scope. |
| Styling | Plain CSS (`style.css`) | A single shared stylesheet was sufficient for consistent nav/layout across the three tool pages; no CSS framework (e.g., Bootstrap/Tailwind) was needed for a UI this small. |
| Hosting/deployment | Vercel (`vercel.json`) | Used only for static site deployment/config, not as a runtime dependency — it has no effect on the IEEE 754 logic itself. |

No `package.json` or `node_modules` are required to run the project, since it has zero runtime dependencies; the three HTML pages can be opened directly or served as static files.

---

References

IEEE. (2019). *IEEE standard for floating-point arithmetic* (IEEE Std 754-2019). Institute of Electrical and Electronics Engineers. https://doi.org/10.1109/IEEESTD.2019.8766229

Oser, P. (n.d.). The IEEE 754 format. Oxford College Math Center, Emory University. Retrieved August 1, 2026, from https://mathcenter.oxford.emory.edu/site/cs170/ieee754/
