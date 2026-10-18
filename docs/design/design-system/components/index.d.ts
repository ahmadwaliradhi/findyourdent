export type IconName = 'check' | 'check-circle' | 'octagon-alert' | 'clock' | 'calendar' | 'info' | 'star' | 'map-pin' | 'mic' | 'shield';

export interface ButtonProps {
  /** Visual weight. One `primary` per view. `danger` only for destructive actions. */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  /** `md` is 48px tall, `sm` 44px (the minimum touch target), `lg` 56px for the main call to action. */
  size?: 'sm' | 'md' | 'lg';
  /** Shows a spinner, disables the button and sets aria-busy. Keep the label. */
  loading?: boolean;
  disabled?: boolean;
  /** Full-width, for mobile forms. */
  block?: boolean;
  /** Leading icon from the icon set. */
  icon?: IconName;
  /** Renders an anchor instead of a button. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children: React.ReactNode;
}
export interface BadgeProps {
  /** Status badges add an icon so meaning never rides on color alone. */
  variant?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  /** Override the default status icon, or pass `false` for none. */
  icon?: IconName | false;
  children: React.ReactNode;
}
export interface CardProps {
  variant?: 'flat' | 'emergency';
  /** Root element, `section` by default. */
  as?: string;
  /** Id of the heading that names the card. */
  labelledBy?: string;
  children: React.ReactNode;
}
export interface FieldProps {
  /** Always visible; never replace it with the placeholder. */
  label: string;
  id?: string;
  name?: string;
  hint?: string;
  /** Message shown under the field with an icon; also sets aria-invalid. */
  error?: string;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  defaultValue?: string;
  disabled?: boolean;
}
export interface UrgencyNoticeProps {
  /** The four Guidance urgency tiers. */
  tier: 'darurat' | 'segera' | 'terjadwal' | 'rutin';
  label: string;
  description: string;
}
export interface TestimonyCardProps {
  id?: string;
  providerName: string;
  /** Provider type and region, e.g. "Klinik · Kota Bandung, Jawa Barat". */
  meta: string;
  verified?: boolean;
  verifiedLabel?: string;
  ratings: { label: string; score: number }[];
  ratingsLabel?: string;
  excerpt: string;
  procedure?: string;
  price?: string;
  byline: string;
  href?: string;
  readMore?: string;
}
