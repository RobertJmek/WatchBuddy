import { Feather } from '@expo/vector-icons';

// Feather line icons on both platforms, so iOS and Android render identically
// and tint to any theme color. Add glyphs here as icons are adopted.
const GLYPHS = {
  magnifyingglass: 'search',
  xmark: 'x',
  calendar: 'calendar',
} as const;

type Props = {
  name: keyof typeof GLYPHS;
  size: number;
  tintColor: string;
};

export function IconSymbol({ name, size, tintColor }: Props) {
  return <Feather name={GLYPHS[name]} size={size} color={tintColor} />;
}
