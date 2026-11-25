// A Testimony's Payment Method as text (spec 07). Always the author's own visit; never
// worded as what a Provider "accepts".
import { insurerName } from "@findyourdent/contracts";
import type { PaymentMethod } from "@findyourdent/contracts/firestore";
import type { TFunction } from "i18next";
import type { Language } from "~/i18n/config";

export function paymentMethodText(method: PaymentMethod, t: TFunction, language: Language): string {
  const kind = t(`paymentMethod.kind.${method.method}`);
  return method.method === "asuransi" ? `${kind} (${insurerName(method.insurer, language)})` : kind;
}
