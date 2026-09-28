import { UserContextProps, UserState } from "@/types/user";
import { createContext, ReactNode, useContext, useState } from "react";

export const UserContext = createContext<UserContextProps>({ user: null, setUser: () => {} });

export default function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserState | null>(null);

  return <UserContext.Provider value={{ user, setUser }}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
