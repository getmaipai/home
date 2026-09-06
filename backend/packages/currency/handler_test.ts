import { assertEquals } from "jsr:@std/assert@1";
import { parseCurrencyExpression, summarizeConversion } from "./handler.ts";

Deno.test("parses an amount and two currency words, joined by 'to'", () => {
  const parsed = parseCurrencyExpression("100 dollars to euros");
  assertEquals(parsed, { amount: 100, from: "USD", to: "EUR" });
});

Deno.test("parses 'for' and 'in' the same as 'to'", () => {
  assertEquals(parseCurrencyExpression("50 usd for gbp"), { amount: 50, from: "USD", to: "GBP" });
  assertEquals(parseCurrencyExpression("50 usd in gbp"), { amount: 50, from: "USD", to: "GBP" });
});

Deno.test("accepts a bare three-letter code not in the curated word table", () => {
  assertEquals(parseCurrencyExpression("20 sek to nok"), { amount: 20, from: "SEK", to: "NOK" });
});

Deno.test("accepts a decimal amount and comma thousands separators", () => {
  assertEquals(parseCurrencyExpression("1,250.50 dollars to euros"), { amount: 1250.5, from: "USD", to: "EUR" });
});

Deno.test("returns null for text with no recognizable amount-currency-currency shape", () => {
  assertEquals(parseCurrencyExpression("what's the exchange rate"), null);
});

Deno.test("returns null when a currency word isn't recognized and isn't a bare three-letter code", () => {
  assertEquals(parseCurrencyExpression("100 doubloons to euros"), null);
});

Deno.test("summarizes a real rate, rounded to two decimals", () => {
  const result = summarizeConversion({ amount: 5, rates: { EUR: 4.30219 } }, { amount: 5, from: "USD", to: "EUR" });
  assertEquals(result.text, "5 USD is about 4.3 EUR.");
});

// frankfurter.dev's real behavior for a same-currency pair: a 200 with
// {"message": "bad currency pair"}, no `rates` key at all - not a
// network failure, so it must read as "no rate found", not crash on a
// missing key or interpolate "undefined."
Deno.test("reads a response with no matching rate as not found, not a crash", () => {
  const result = summarizeConversion({ message: "bad currency pair" }, { amount: 5, from: "USD", to: "USD" });
  assertEquals(result.text, "I couldn't find an exchange rate from USD to USD.");
});

Deno.test("reads a malformed (non-object) response as not found, not a throw", () => {
  const result = summarizeConversion(null, { amount: 5, from: "USD", to: "EUR" });
  assertEquals(result.text, "I couldn't find an exchange rate from USD to EUR.");
});
