import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo } from 'react';

import { PressScale } from '@/components/press-scale';
import { PlaceholderBg } from '@/constants/theme';
import { openTitle } from '@/lib/navigation';
import { imageUrl, type MediaType } from '@/lib/tmdb';

/** A poster tile in a 3-column title grid; opens the title. */
export const GridPoster = memo(function GridPoster({
  width,
  tmdbId,
  mediaType,
  name,
  posterPath,
}: {
  width: number;
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  posterPath: string | null;
}) {
  const router = useRouter();
  return (
    <PressScale
      style={{ width }}
      onPress={() => openTitle(router, { tmdbId, mediaType, name })}
      accessibilityRole="button"
      accessibilityLabel={name}>
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
    </PressScale>
  );
});
