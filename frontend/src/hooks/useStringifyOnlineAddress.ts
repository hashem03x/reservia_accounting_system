import { Address } from "@/types/user";
import useGovernoratesHelpers from "./useGovernoratesHelpers";

// Accepts a missing address (returns "") so components can call it unconditionally, as hooks must be.
export default function useStringifyOnlineAddress(address: Address | null | undefined, { excludeGovernorate = false } = {}) {
  const { getGovernorateNameById } = useGovernoratesHelpers();
  if (!address) return "";

  const governorateName = getGovernorateNameById(address.governorate);

  let addressString = "";
  if (governorateName && !excludeGovernorate) addressString += `${governorateName}, `;
  if (address.city) addressString += `${address.city}`;
  if (address.street) addressString += `, ${address.street}`;
  if (address.landmark) addressString += `, ${address.landmark}`;
  if (address.details) addressString += `, ${address.details}`;
  return addressString;
}
