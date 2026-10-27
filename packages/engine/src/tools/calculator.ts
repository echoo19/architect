import { Rational } from './rational';

/** The expression can't be evaluated as written. The message says where and how to fix it. */
export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

export const MAX_EXPRESSION_LENGTH = 1000;
const MAX_NESTING = 64;
const MAX_EXPONENT = 100;
const MAX_ROUND_DIGITS = 15;

type SymbolText = '+' | '-' | '*' | '/' | '%' | '(' | ')' | ',';
interface SymbolToken {
  kind: 'symbol';
  text: SymbolText;
  at: number;
}
interface NameToken {
  kind: 'name';
  text: string;
  at: number;
}
type Token =
  | SymbolToken
  | NameToken
  | { kind: 'number'; text: string; at: number }
  | { kind: 'end'; at: number };

const SYMBOLS: readonly string[] = ['+', '-', '*', '/', '%', '(', ')', ','];
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const WHITESPACE = /\s+/y;
const NO_CURRENCY = 'Write plain numbers without currency symbols.';
const CHARACTER_HINTS: Readonly<Record<string, string>> = {
  $: NO_CURRENCY,
  '€': NO_CURRENCY,
  '£': NO_CURRENCY,
  '×': 'Use * to multiply.',
  '÷': 'Use / to divide.',
  '^': 'Powers are not supported; multiply instead.',
  '=': 'Write only the expression, without "=".',
};

type Fn = (args: readonly Rational[], name: NameToken) => Rational;

const FUNCTIONS: ReadonlyMap<string, Fn> = new Map<string, Fn>([
  [
    'round',
    (args, name) => {
      checkArity(name, args, 1, 2);
      const [value, digits = Rational.of(0n)] = args as [Rational, Rational?];
      if (!digits.isInteger() || Math.abs(digits.toNumber()) > MAX_ROUND_DIGITS) {
        throw new CalculationError(
          `round's second argument is the number of decimal places: a whole number from -${MAX_ROUND_DIGITS} to ${MAX_ROUND_DIGITS}.`,
        );
      }
      return value.round(digits.toNumber());
    },
  ],
  ['floor', (args, name) => single(name, args).floor()],
  ['ceil', (args, name) => single(name, args).ceil()],
  ['abs', (args, name) => single(name, args).abs()],
  ['min', (args, name) => extreme(name, args, -1)],
  ['max', (args, name) => extreme(name, args, 1)],
]);

/**
 * Evaluates an arithmetic expression exactly: numbers, `+ - * / %`, parentheses, unary minus,
 * and round, floor, ceil, min, max and abs. It parses the text itself and never runs code.
 */
export function calculate(expression: string): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculationError(
      `The expression is too long; keep it under ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }
  if (expression.trim() === '') throw new CalculationError('The expression is empty.');
  return new Parser(tokenize(expression)).parse().toNumber();
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const space = matchAt(WHITESPACE, source, at);
    if (space) {
      at += space.length;
      continue;
    }
    const char = String.fromCodePoint(source.codePointAt(at) ?? 0);
    if (SYMBOLS.includes(char)) {
      if (char === '*' && source[at + 1] === '*') {
        throw new CalculationError(
          `Powers are not supported (position ${at + 1}); multiply instead.`,
        );
      }
      tokens.push({ kind: 'symbol', text: char as SymbolText, at });
      at += 1;
      continue;
    }
    const number = matchAt(NUMBER, source, at);
    if (number) {
      tokens.push({ kind: 'number', text: number, at });
      at += number.length;
      continue;
    }
    const name = matchAt(NAME, source, at);
    if (name) {
      tokens.push({ kind: 'name', text: name, at });
      at += name.length;
      continue;
    }
    const hint = CHARACTER_HINTS[char];
    throw new CalculationError(
      `Unexpected "${char}" at position ${at + 1}.${hint ? ` ${hint}` : ''}`,
    );
  }
  tokens.push({ kind: 'end', at });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Rational {
    const value = this.sum();
    const token = this.peek();
    if (token.kind !== 'end') throw unexpected(token);
    return value;
  }

  private sum(): Rational {
    let value = this.product();
    for (let token = this.peek(); isSymbol(token, '+', '-'); token = this.peek()) {
      this.index += 1;
      const right = this.product();
      value = token.text === '+' ? value.plus(right) : value.minus(right);
    }
    return value;
  }

  private product(): Rational {
    let value = this.unary();
    for (let token = this.peek(); isSymbol(token, '*', '/', '%'); token = this.peek()) {
      this.index += 1;
      const right = this.unary();
      if (token.text === '*') {
        value = value.times(right);
        continue;
      }
      if (right.isZero()) {
        const what = token.text === '/' ? 'Division' : 'Remainder';
        throw new CalculationError(`${what} by zero at position ${token.at + 1}.`);
      }
      value = token.text === '/' ? value.dividedBy(right) : value.remainder(right);
    }
    return value;
  }

  private unary(): Rational {
    const token = this.peek();
    if (!isSymbol(token, '+', '-')) return this.primary();
    this.index += 1;
    const operand = this.nested(() => this.unary());
    return token.text === '-' ? operand.negate() : operand;
  }

  private primary(): Rational {
    const token = this.take();
    if (token.kind === 'number') return parseLiteral(token.text, token.at);
    if (token.kind === 'name') return this.call(token);
    if (isSymbol(token, '(')) {
      const value = this.nested(() => this.sum());
      this.close(token);
      return value;
    }
    throw unexpected(token);
  }

  private call(name: NameToken): Rational {
    const fn = FUNCTIONS.get(name.text.toLowerCase());
    if (!fn) throw unknownName(name);
    const open = this.take();
    if (!isSymbol(open, '(')) {
      throw new CalculationError(
        `${name.text} needs its arguments in parentheses, like ${name.text.toLowerCase()}(2.5).`,
      );
    }
    const args: Rational[] = [];
    if (!isSymbol(this.peek(), ')')) {
      do args.push(this.nested(() => this.sum()));
      while (this.accept(','));
    }
    this.close(open);
    return fn(args, name);
  }

  private close(open: Token): void {
    const token = this.take();
    if (isSymbol(token, ')')) return;
    if (token.kind === 'end') {
      throw new CalculationError(`Missing ")" for the "(" at position ${open.at + 1}.`);
    }
    throw unexpected(token);
  }

  private nested(parse: () => Rational): Rational {
    this.depth += 1;
    if (this.depth > MAX_NESTING)
      throw new CalculationError('The expression is nested too deeply.');
    try {
      return parse();
    } finally {
      this.depth -= 1;
    }
  }

  private accept(text: SymbolText): boolean {
    if (!isSymbol(this.peek(), text)) return false;
    this.index += 1;
    return true;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'end', at: 0 };
  }

  private take(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index += 1;
    return token;
  }
}

function isSymbol<T extends SymbolText>(
  token: Token,
  ...texts: T[]
): token is SymbolToken & { text: T } {
  return token.kind === 'symbol' && (texts as readonly SymbolText[]).includes(token.text);
}

function parseLiteral(text: string, at: number): Rational {
  const exponent = /[eE]([+-]?\d+)$/.exec(text)?.[1];
  if (exponent !== undefined && Math.abs(Number(exponent)) > MAX_EXPONENT) {
    throw new CalculationError(`The number at position ${at + 1} is out of range.`);
  }
  return Rational.parseDecimal(text);
}

function unexpected(token: Token): CalculationError {
  if (token.kind === 'end') return new CalculationError('The expression ends too early.');
  const position = `at position ${token.at + 1}`;
  if (isSymbol(token, ',')) {
    return new CalculationError(
      `Unexpected "," ${position}. Write numbers without thousands separators, like 1234.5.`,
    );
  }
  if (isSymbol(token, ')')) {
    return new CalculationError(`Unexpected ")" ${position}, with no "(" to close.`);
  }
  if (token.kind === 'name') return unknownName(token);
  return new CalculationError(`Unexpected "${token.text}" ${position}.`);
}

function unknownName(token: NameToken): CalculationError {
  const hint =
    token.text.toLowerCase() === 'x'
      ? 'Use * to multiply.'
      : `The functions are ${[...FUNCTIONS.keys()].join(', ')}.`;
  return new CalculationError(`Unknown name "${token.text}" at position ${token.at + 1}. ${hint}`);
}

function checkArity(name: NameToken, args: readonly Rational[], min: number, max: number): void {
  if (args.length >= min && args.length <= max) return;
  const noun = `argument${min === 1 ? '' : 's'}`;
  const expected =
    min === max
      ? `${min} ${noun}`
      : max === Number.POSITIVE_INFINITY
        ? `at least ${min} ${noun}`
        : `${min} to ${max} arguments`;
  throw new CalculationError(
    `${name.text.toLowerCase()} takes ${expected}, but got ${args.length}.`,
  );
}

function single(name: NameToken, args: readonly Rational[]): Rational {
  checkArity(name, args, 1, 1);
  return args[0] as Rational;
}

function extreme(name: NameToken, args: readonly Rational[], direction: 1 | -1): Rational {
  checkArity(name, args, 1, Number.POSITIVE_INFINITY);
  return args.reduce((best, value) => (value.compare(best) * direction > 0 ? value : best));
}

function matchAt(pattern: RegExp, source: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(source)?.[0] ?? null;
}
