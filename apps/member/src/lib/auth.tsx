import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTranslations, type Language, type TranslationTree } from '@gymflow/i18n';
import { loadTokens, login as apiLogin, setSessionEndedHandler, signOutEverywhere } from './api';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  language: Language;
  t: TranslationTree;
  signIn: (gymCode: string, mobile: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const LANG_KEY = 'gymflow.language';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    (async () => {
      const [hasTokens, storedLang] = await Promise.all([
        loadTokens(),
        AsyncStorage.getItem(LANG_KEY),
      ]);
      setSignedIn(hasTokens);
      if (storedLang === 'en' || storedLang === 'te') setLanguageState(storedLang);
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
