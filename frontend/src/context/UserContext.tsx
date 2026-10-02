import { UserContextProps, UserState } from "@/types/user";
import { createContext, ReactNode, useContext, useState } from "react";

export const UserContext = createContext<UserContextProps>({
  user: null,
  setUser: () => {},
  isInitializing: true,
  setIsInitializing: () => {},
});

export default function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserState | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  return (
    <UserContext.Provider value={{ user, setUser, isInitializing, setIsInitializing }}>{children}</UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
