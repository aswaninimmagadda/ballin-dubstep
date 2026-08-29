import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTranslations, type Language, type TranslationTree } from '@gymflow/i18n';
import { loadTokens, login as apiLogin, setSessionEndedHandler, signOutEverywhere } from './api';
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
  signIn: (gymCode: string, mobile: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const LANG_KEY = 'gymflow.language';
const BRAND_KEY = 'gymflow.brandColor';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [language, setLanguageState] = useState<Language>('en');
  const [brandColor, setBrandColorState] = useState<string>(theme.color.primary);

  useEffect(() => {
    (async () => {
      const [hasTokens, storedLang, storedBrand] = await Promise.all([
        loadTokens(),
        AsyncStorage.getItem(LANG_KEY),
        AsyncStorage.getItem(BRAND_KEY),
      ]);
      setSignedIn(hasTokens);
      if (storedLang === 'en' || storedLang === 'te') setLanguageState(storedLang);
      if (storedBrand && /^#[0-9a-fA-F]{6}$/.test(storedBrand)) setBrandColorState(storedBrand);
      setReady(true);
    })();
  }, []);

  // When the server definitively rejects the session (the gym deactivated the
  // member, the account was deleted, the gym was suspended), send the member
  // back to the sign-in screen. Clearing the tokens alone left the UI still
  // believing it was signed in, every request 401'ing behind a spinner.
  useEffect(() => {
    setSessionEndedHandler(() => setSignedIn(false));
    return () => setSessionEndedHandler(null);
  }, []);

  const signIn = useCallback(async (gymCode: string, mobile: string, password: string) => {
    await apiLogin(gymCode, mobile, password);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await signOutEverywhere();
    setSignedIn(false);
  }, []);

  const setBrandColor = useCallback((color: string | null) => {
    // Validated because it is interpolated into styles; the column is
    // CHECK-constrained server-side but the app should not depend on that.
    const next = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : theme.color.primary;
    setBrandColorState(next);
    void AsyncStorage.setItem(BRAND_KEY, next);
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    await AsyncStorage.setItem(LANG_KEY, lang);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ready,
        signedIn,
        language,
        t: getTranslations(language),
        brandColor,
        setBrandColor,
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
