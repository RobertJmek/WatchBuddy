import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Text } from 'react-native';

// SF Symbols render natively on iOS only; Android gets the `fallback` node.
// Keep the map tiny — add glyphs as symbols are adopted.
const FALLBACKS: Record<string, string> = {
  magnifyingglass: '🔍',
  xmark: '✕',
  calendar: '📅',
};

type Props = {
  name: SymbolViewProps['name'];
  size: number;
  tintColor: string;
};

export function IconSymbol({ name, size, tintColor }: Props) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={tintColor}
      fallback={
        <Text style={{ fontSize: size - 2, color: tintColor }}>
          {(typeof name === 'string' && FALLBACKS[name]) || '•'}
        </Text>
      }
    />
  );
}
