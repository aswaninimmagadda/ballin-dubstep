import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTranslations, type Language, type TranslationTree } from '@gymflow/i18n';
import {
  api,
  loadTokens,
  login as apiLogin,
  setSessionEndedHandler,
  signOutEverywhere,
} from './api';
import { theme } from './theme';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  language: Language;
  t: TranslationTree;
  /**
   * The gym's own accent colour, from GET /me.
   *
   * The API has always returned primaryColor and logoPath and the app read
   * neither, so every gym's members saw the same GymFlow green and per-gym
   * branding — a thing the owner configures in Settings — reached nothing.
   * Cached so the gym's colour is on screen at first paint, not one network
   * round trip later.
   */
  brandColor: string;
  setBrandColor: (color: string | null) => void;
  /**
   * Which parts of the product this gym runs, from GET /me. Cached so the
   * tab bar is right at first paint rather than flashing a Training tab at a
   * member of a gym that does not offer training.
   */
  features: MemberFeatures;
  setFeatures: (features: MemberFeatures | undefined) => void;
  signIn: (gymCode: string, mobile: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const LANG_KEY = 'gymflow.language';
const BRAND_KEY = 'gymflow.brandColor';
const FEATURES_KEY = 'gymflow.features';

export interface MemberFeatures {
  attendance: boolean;
  pt: boolean;
}

// Both on until the gym says otherwise — the same default the server applies
// for a tenant with no explicit feature_flags row.
const ALL_FEATURES: MemberFeatures = { attendance: true, pt: true };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [language, setLanguageState] = useState<Language>('en');
  const [brandColor, setBrandColorState] = useState<string>(theme.color.primary);
  const [features, setFeaturesState] = useState<MemberFeatures>(ALL_FEATURES);

  useEffect(() => {
    (async () => {
      const [hasTokens, storedLang, storedBrand, storedFeatures] = await Promise.all([
        loadTokens(),
        AsyncStorage.getItem(LANG_KEY),
        AsyncStorage.getItem(BRAND_KEY),
        AsyncStorage.getItem(FEATURES_KEY),
      ]);
      setSignedIn(hasTokens);
      if (storedLang === 'en' || storedLang === 'te') setLanguageState(storedLang);
      if (storedBrand && /^#[0-9a-fA-F]{6}$/.test(storedBrand)) setBrandColorState(storedBrand);
      if (storedFeatures) {
        try {
          const parsed = JSON.parse(storedFeatures) as Partial<MemberFeatures>;
          setFeaturesState({
            attendance: parsed.attendance !== false,
            pt: parsed.pt !== false,
          });
        } catch {
          // A corrupt cache must not stop the app starting.
        }
      }
      setReady(true);
    })();
  }, []);

  // When the server definitively rejects the session (the gym deactivated the
  // member, the account was deleted, the gym was suspended), send the member
  // back to the sign-in screen. Clearing the tokens alone left the UI still
  // believing it was signed in, every request 401'ing behind a spinner.
  useEffect(() => {
    // Reset the same gym-owned state signOut does. This path fires when the
    // SERVER ends the session — the gym deactivated the member, the account
    // was deleted, the gym was suspended — and it used to clear only the
    // signed-in flag, leaving the previous gym's colour and feature set on
    // the sign-in screen and into whoever signed in next.
    setSessionEndedHandler(() => {
      setSignedIn(false);
      setBrandColorState(theme.color.primary);
      setFeaturesState(ALL_FEATURES);
      void AsyncStorage.multiRemove([BRAND_KEY, FEATURES_KEY]);
    });
    return () => setSessionEndedHandler(null);
  }, []);

  const signIn = useCallback(async (gymCode: string, mobile: string, password: string) => {
    await apiLogin(gymCode, mobile, password);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await signOutEverywhere();
    setSignedIn(false);
    // The gym's colour and feature set belong to the gym that was signed in,
    // not to this phone — a different member signing in next should not
    // briefly see the previous gym's branding. The LANGUAGE is deliberately
    // kept: it is the member's own choice, and wiping it used to strand a
    // Telugu speaker on an English sign-in screen.
    setBrandColorState(theme.color.primary);
    setFeaturesState(ALL_FEATURES);
    await AsyncStorage.multiRemove([BRAND_KEY, FEATURES_KEY]);
  }, []);

  const setFeatures = useCallback((next: MemberFeatures | undefined) => {
    // An older cached /me has no features field. Leave what we have rather
    // than switching tabs off on the strength of a missing key.
    if (!next) return;
    const value: MemberFeatures = { attendance: next.attendance !== false, pt: next.pt !== false };
    setFeaturesState(value);
    void AsyncStorage.setItem(FEATURES_KEY, JSON.stringify(value));
  }, []);

  const setBrandColor = useCallback((color: string | null) => {
    // Validated because it is interpolated into styles; the column is
    // CHECK-constrained server-side but the app should not depend on that.
    const next = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : theme.color.primary;
    setBrandColorState(next);
    void AsyncStorage.setItem(BRAND_KEY, next);
  }, []);

  const setLanguage = useCallback(
    async (lang: Language) => {
      setLanguageState(lang);
      await AsyncStorage.setItem(LANG_KEY, lang);
      // And tell the server, so the notifications it renders — payment
      // receipts, renewal confirmations — come in the same language as the
      // screens. Only meaningful once signed in; on the sign-in screen the
      // choice is local until there is an account to attach it to.
      if (signedIn) await api.setLanguage(lang);
    },
    [signedIn],
  );

  return (
    <AuthContext.Provider
      value={{
        ready,
        signedIn,
        language,
        t: getTranslations(language),
        brandColor,
        setBrandColor,
        features,
        setFeatures,
        signIn,
        signOut,
        setLanguage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
