import { Feather } from '@expo/vector-icons';

// Feather line icons on both platforms, so iOS and Android render identically
// and tint to any theme color. Add glyphs here as icons are adopted.
const GLYPHS = {
  magnifyingglass: 'search',
  xmark: 'x',
  calendar: 'calendar',
  'chevron.right': 'chevron-right',
  film: 'film',
  'book.closed': 'book-open',
  'person.2': 'users',
  pencil: 'edit-2',
  heart: 'heart',
  bubble: 'message-circle',
  ellipsis: 'more-horizontal',
  bell: 'bell',
  'paperplane.fill': 'send',
} as const;

export type IconName = keyof typeof GLYPHS;

type Props = {
  name: IconName;
  size: number;
  tintColor: string;
};

export function IconSymbol({ name, size, tintColor }: Props) {
  return <Feather name={GLYPHS[name]} size={size} color={tintColor} />;
}
