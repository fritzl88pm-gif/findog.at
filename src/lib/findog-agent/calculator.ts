/**
 * Exact decimal calculator with a deliberately restricted grammar.
 *
 * There is no `eval`, no `Function`, no shell and no JavaScript execution. The
 * evaluator works on exact rational numbers (BigInt numerator/denominator) so
 * `0.1 + 0.2` is exactly `0.3`; only the decimal rendering is rounded when a
 * result is not a terminating decimal, and that is reported explicitly.
 */

export type FindogAgentCalculationErrorCode =
  | "malformed_expression"
  | "division_by_zero"
  | "expression_too_long"
  | "expression_too_deep"
  | "invalid_number";

export class FindogAgentCalculationError extends Error {
  readonly code: FindogAgentCalculationErrorCode;

  constructor(code: FindogAgentCalculationErrorCode, message: string) {
    super(message);
    this.name = "FindogAgentCalculationError";
    this.code = code;
  }
}

export type FindogAgentCalculationResult = {
  value: string;
  approximate: boolean;
};

const MAX_EXPRESSION_CHARACTERS = 500;
const MAX_DEPTH = 32;
const MAX_FRACTION_DIGITS = 20;

type Fraction = { numerator: bigint; denominator: bigint };

type Token =
  | { type: "number"; raw: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" };

function malformed(): never {
  throw new FindogAgentCalculationError(
    "malformed_expression",
    "Der Rechenausdruck ist ungültig. Erlaubt sind Zahlen, Klammern und + - * /.",
  );
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let x = absolute(a);
  let y = absolute(b);
  while (y) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x === 0n ? 1n : x;
}

function normalize(fraction: Fraction): Fraction {
  if (fraction.denominator === 0n) {
    throw new FindogAgentCalculationError(
      "division_by_zero",
      "Eine Division durch null ist nicht erlaubt.",
    );
  }
  let { numerator, denominator } = fraction;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Fraction, right: Fraction): Fraction {
  return normalize({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function subtract(left: Fraction, right: Fraction): Fraction {
  return normalize({
    numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

function multiply(left: Fraction, right: Fraction): Fraction {
  return normalize({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  });
}

function divide(left: Fraction, right: Fraction): Fraction {
  if (right.numerator === 0n) {
    throw new FindogAgentCalculationError(
      "division_by_zero",
      "Eine Division durch null ist nicht erlaubt.",
    );
  }
  return normalize({
    numerator: left.numerator * right.denominator,
    denominator: left.denominator * right.numerator,
  });
}

function parseDecimal(raw: string): Fraction {
  const match = /^(\d*)(?:\.(\d+))?$/.exec(raw);
  const integerDigits = match?.[1] ?? "";
  const fractionDigits = match?.[2] ?? "";
  if (!match || (!integerDigits && !fractionDigits)) {
    throw new FindogAgentCalculationError(
      "invalid_number",
      "Der Rechenausdruck enthält eine ungültige Zahl.",
    );
  }
  const scale = 10n ** BigInt(fractionDigits.length);
  return normalize({
    numerator: BigInt(`${integerDigits || "0"}${fractionDigits}`),
    denominator: scale,
  });
}

function tokenize(expression: string): Token[] {
  if (!/^[0-9+\-*/().\s]*$/.test(expression)) {
    malformed();
  }

  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (character === " " || character === "\t" || character === "\n") {
      index += 1;
      continue;
    }
    if (character === "+" || character === "-" || character === "*" || character === "/") {
      tokens.push({ type: "operator", value: character });
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ type: "paren", value: character });
      index += 1;
      continue;
    }
    if (character === "." || (character >= "0" && character <= "9")) {
      let end = index;
      let dots = 0;
      while (end < expression.length) {
        const next = expression[end];
        if (next === ".") {
          dots += 1;
          if (dots > 1) {
            malformed();
          }
          end += 1;
          continue;
        }
        if (next >= "0" && next <= "9") {
          end += 1;
          continue;
        }
        break;
      }
      const raw = expression.slice(index, end);
      if (raw === ".") {
        malformed();
      }
      tokens.push({ type: "number", raw });
      index = end;
      continue;
    }
    malformed();
  }

  if (tokens.length === 0) {
    malformed();
  }
  return tokens;
}

function formatFraction(fraction: Fraction): FindogAgentCalculationResult {
  const negative = fraction.numerator < 0n;
  const numerator = absolute(fraction.numerator);
  const integerPart = numerator / fraction.denominator;
  let remainder = numerator % fraction.denominator;
  const sign = negative ? "-" : "";

  if (remainder === 0n) {
    return { value: `${sign}${integerPart.toString()}`, approximate: false };
  }

  const digits: string[] = [];
  let exact = false;
  for (let position = 0; position < MAX_FRACTION_DIGITS; position += 1) {
    remainder *= 10n;
    digits.push((remainder / fraction.denominator).toString());
    remainder %= fraction.denominator;
    if (remainder === 0n) {
      exact = true;
      break;
    }
  }

  return {
    value: `${sign}${integerPart.toString()}.${digits.join("")}`,
    approximate: !exact,
  };
}

/**
 * Evaluates a bounded infix decimal expression. Throws
 * {@link FindogAgentCalculationError} for anything outside the grammar.
 */
export function evaluateFindogAgentExpression(expression: unknown): FindogAgentCalculationResult {
  if (typeof expression !== "string") {
    malformed();
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    malformed();
  }
  if (trimmed.length > MAX_EXPRESSION_CHARACTERS) {
    throw new FindogAgentCalculationError(
      "expression_too_long",
      `Der Rechenausdruck darf höchstens ${MAX_EXPRESSION_CHARACTERS} Zeichen enthalten.`,
    );
  }

  const tokens = tokenize(trimmed);
  let position = 0;
  let depth = 0;

  const peek = (): Token | null => tokens[position] ?? null;

  function parsePrimary(): Fraction {
    const token = peek();
    if (!token) {
      malformed();
    }
    if (token.type === "number") {
      position += 1;
      return parseDecimal(token.raw);
    }
    if (token.type === "paren" && token.value === "(") {
      position += 1;
      depth += 1;
      if (depth > MAX_DEPTH) {
        throw new FindogAgentCalculationError(
          "expression_too_deep",
          "Der Rechenausdruck ist zu stark verschachtelt.",
        );
      }
      const inner = parseExpression();
      const closing = peek();
      if (!closing || closing.type !== "paren" || closing.value !== ")") {
        malformed();
      }
      position += 1;
      depth -= 1;
      return inner;
    }
    malformed();
  }

  function parseUnary(): Fraction {
    const token = peek();
    if (token && token.type === "operator" && (token.value === "+" || token.value === "-")) {
      position += 1;
      const operand = parseUnary();
      return token.value === "-"
        ? { numerator: -operand.numerator, denominator: operand.denominator }
        : operand;
    }
    return parsePrimary();
  }

  function parseTerm(): Fraction {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "operator" || (token.value !== "*" && token.value !== "/")) {
        return left;
      }
      position += 1;
      const right = parseUnary();
      left = token.value === "*" ? multiply(left, right) : divide(left, right);
    }
  }

  function parseExpression(): Fraction {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "operator" || (token.value !== "+" && token.value !== "-")) {
        return left;
      }
      position += 1;
      const right = parseTerm();
      left = token.value === "+" ? add(left, right) : subtract(left, right);
    }
  }

  const result = parseExpression();
  if (position !== tokens.length) {
    malformed();
  }
  return formatFraction(result);
}
