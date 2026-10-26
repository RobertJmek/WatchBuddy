import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo } from 'react';

import { StyleSheet, View } from 'react-native';

import { PressScale } from '@/components/press-scale';
import { ThemedText } from '@/components/themed-text';
import { Hero, PlaceholderBg } from '@/constants/theme';
import { openTitle } from '@/lib/navigation';
import { imageUrl, type MediaType } from '@/lib/tmdb';

/** A person's score in a poster's corner, on the hero's dark ground so it reads on any artwork. */
export function PosterScore({ value }: { value: number }) {
  return (
    <View style={styles.score}>
      <ThemedText type="smallBold" style={{ color: Hero.text }}>
        {value}
      </ThemedText>
    </View>
  );
}

/** A poster tile in a 3-column title grid; opens the title. */
export const GridPoster = memo(function GridPoster({
  width,
  tmdbId,
  mediaType,
  name,
  posterPath,
  score,
}: {
  width: number;
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  posterPath: string | null;
  /** A person's score for the title, shown in the corner. */
  score?: number;
}) {
  const router = useRouter();
  return (
    <PressScale
      style={{ width }}
      onPress={() => openTitle(router, { tmdbId, mediaType, name })}
      accessibilityRole="button"
      accessibilityLabel={score != null ? `${name}, rated ${score}` : name}>
      <Image
        style={{
          width,
          height: width * 1.5,
          borderRadius: 4,
          backgroundColor: PlaceholderBg,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.35)',
        }}
        source={{ uri: imageUrl(posterPath, 'w342') ?? undefined }}
        contentFit="cover"
        transition={150}
      />
      {score != null ? <PosterScore value={score} /> : null}
    </PressScale>
  );
});

const styles = StyleSheet.create({
  score: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: Hero.pill,
  },
});
