import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { NetadbBridge } from "@/modules/netadb-bridge";

type AdbSessionContextValue = {
  connectedSerial: string | null;
  setConnectedSerial: (serial: string | null) => void;
};

const AdbSessionContext = createContext<AdbSessionContextValue | null>(null);

export function AdbSessionProvider({ children }: PropsWithChildren) {
  const [connectedSerial, setConnectedSerial] = useState<string | null>(null);
  useEffect(() => {
    const subscription = NetadbBridge?.addListener("onShellState", (event) => {
      setConnectedSerial((current) => {
        if (event.state === "ready") return event.serial;
        return current === event.serial ? null : current;
      });
    });
    return () => subscription?.remove();
  }, []);
  const value = useMemo(
    () => ({ connectedSerial, setConnectedSerial }),
    [connectedSerial],
  );

  return (
    <AdbSessionContext.Provider value={value}>
      {children}
    </AdbSessionContext.Provider>
  );
}

export function useAdbSession() {
  const context = useContext(AdbSessionContext);
  if (!context)
    throw new Error("useAdbSession must be used inside AdbSessionProvider");
  return context;
}
