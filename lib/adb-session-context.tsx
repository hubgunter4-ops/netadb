import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";

type AdbSessionContextValue = {
  connectedSerial: string | null;
  setConnectedSerial: (serial: string | null) => void;
};

const AdbSessionContext = createContext<AdbSessionContextValue | null>(null);

export function AdbSessionProvider({ children }: PropsWithChildren) {
  const [connectedSerial, setConnectedSerial] = useState<string | null>(null);
  const value = useMemo(() => ({ connectedSerial, setConnectedSerial }), [connectedSerial]);

  return <AdbSessionContext.Provider value={value}>{children}</AdbSessionContext.Provider>;
}

export function useAdbSession() {
  const context = useContext(AdbSessionContext);
  if (!context) throw new Error("useAdbSession must be used inside AdbSessionProvider");
  return context;
}
