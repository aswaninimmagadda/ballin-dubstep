import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES } from '@gymflow/i18n';
import { readableTextOn } from '@gymflow/utils';
import { useAuth } from '../lib/auth';
import { theme } from '../lib/theme';

/**
 * Choose the app's language.
 *
 * This lived only on the Profile screen, which is behind sign-in — so a
 * Telugu speaker could not read the one screen they had to get through
 * first. Worse, signing out wiped the stored preference, which meant the
 * language could only be reached by someone who was already signed in and
 * had never signed out.
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, brandColor } = useAuth();
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {LANGUAGES.map((lang) => {
        const selected = language === lang.tag;
        return (
          <Pressable
            key={lang.tag}
            onPress={() => void setLanguage(lang.tag)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            // The label is in its own language, always — someone who cannot
            // read the current language has to be able to find their own.
            accessibilityLabel={lang.nativeLabel}
            style={[
              styles.chip,
              selected && { backgroundColor: brandColor, borderColor: brandColor },
            ]}
          >
            <Text
              style={[
                styles.text,
                selected && { color: readableTextOn(brandColor), fontWeight: '700' },
              ]}
            >
              {lang.nativeLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowCompact: { justifyContent: 'center' },
  chip: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.full,
    paddingHorizontal: 16,
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  text: { fontSize: 14, color: theme.color.text },
});
