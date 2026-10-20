// Normalização de contato: é o que permite ligar um lead ao cadastro feito dias depois,
// muitas vezes digitado de outro jeito ("Ana@Mail.com " vs "ana@mail.com").

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Telefone brasileiro: guarda só dígitos, sem DDI 55, com DDD.
// Aceita fixo (10 dígitos) e celular (11). Celular antigo sem o 9 recebe o 9 extra.
export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, ""); // prefixo de operadora/DDD com zero
  if (digits.length === 10 && /^[6-9]$/.test(digits[2] ?? "")) digits = digits.slice(0, 2) + "9" + digits.slice(2);
  return digits.length === 10 || digits.length === 11 ? digits : null;
}
