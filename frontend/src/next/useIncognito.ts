import { useCallback, useState } from "react";
import { readIncognitoCache, writeIncognitoCache } from "@/next/incognitoCache";

/** Session-only client state: a fresh tab starts with incognito off. */
export function useIncognito(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readIncognitoCache);
  const setIncognito = useCallback((next: boolean) => {
    writeIncognitoCache(next);
    setOn(next);
  }, []);
  return [on, setIncognito];
}
