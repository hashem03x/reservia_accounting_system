import { UserState } from "@/types/user";

// The login / refresh / OAuth / change-password response body.
type AuthResponse = { data: Omit<UserState, "accessToken">; token?: string; accessToken?: string };

export default function extractUserInfo(user: AuthResponse): UserState {
  return {
    _id: user.data._id,
    name: user.data.name,
    email: user.data.email,
    phone: user.data.phone,
    role: user.data.role,
    permissions: user.data.permissions,
    addresses: user.data.addresses,
    wishlist: user.data.wishlist,
    createdAt: user.data.createdAt,
    updatedAt: user.data.updatedAt,
    accessToken: user.token || user.accessToken || "",
  };
}
