// Valores apresentados no PDV são calculados em centavos inteiros. O banco
// recalcula cada linha com NUMERIC e é a fonte definitiva da venda.
export function priceCents(price: number): bigint {
  return BigInt(Math.round(Number(price) * 100));
}
export function quantityMilli(value: string, unit: string): bigint | null {
  if (!/^\d+(\.\d{0,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
  if (result <= 0n || (["UN", "CX", "PCT"].includes(unit) && result % 1000n !== 0n)) return null;
  return result;
}
export function lineCents(price: number, milli: bigint): bigint {
  return (priceCents(price) * milli + 500n) / 1000n;
}
export function parseMoneyCents(value: string): bigint | null {
  if (!/^\d+([.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
}
export function moneyDecimal(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
export function formatMoney(cents: bigint): string {
  const sign = cents < 0n ? "−" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}R$ ${new Intl.NumberFormat("pt-BR").format(absolute / 100n)},${String(absolute % 100n).padStart(2, "0")}`;
}
