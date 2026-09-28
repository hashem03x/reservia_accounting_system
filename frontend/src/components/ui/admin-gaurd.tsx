import { useRef } from "react";
import { useUser } from "@/context/UserContext";
import { isAdmin } from "@/utils/constants/roles";

export default function AdminGaurd({ children }: { children: React.ReactNode }) {
  const { user: loggedInUser } = useUser();
  const isOK = loggedInUser && useRef(isAdmin(loggedInUser.role)).current; // Ref to avoid re-renders
  return isOK ? children : null;
}
