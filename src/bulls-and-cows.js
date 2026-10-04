import { randomInt } from 'node:crypto';

export function generateSecret() {
  const digits = Array.from({ length: 10 }, (_, index) => String(index));
  for (let index = digits.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [digits[index], digits[swapIndex]] = [digits[swapIndex], digits[index]];
  }
  return digits.slice(0, 4).join('');
}

export function evaluateGuess(secret, guess) {
  let a = 0;
  let matchingDigits = 0;
  for (let index = 0; index < 4; index += 1) {
    if (secret[index] === guess[index]) a += 1;
    if (secret.includes(guess[index])) matchingDigits += 1;
  }
  return { a, b: matchingDigits - a };
}
