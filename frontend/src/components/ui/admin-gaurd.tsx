import { useRef } from "react";
import { useUser } from "@/context/UserContext";
import { isAdmin } from "@/utils/constants/roles";

export default function AdminGaurd({ children }: { children: React.ReactNode }) {
  const { user: loggedInUser } = useUser();
  const isAdminRef = useRef(loggedInUser ? isAdmin(loggedInUser.role) : false); // Ref to avoid re-renders
  const isOK = loggedInUser && isAdminRef.current;
  return isOK ? children : null;
}
