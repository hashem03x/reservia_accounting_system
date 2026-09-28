import { Address } from "@/types/user";
import useGovernoratesHelpers from "./useGovernoratesHelpers";

export default function useStringifyOnlineAddress(address: Address, { excludeGovernorate = false } = {}) {
  const { getGovernorateNameById } = useGovernoratesHelpers();

  const governorateName = getGovernorateNameById(address.governorate);

  let addressString = "";
  if (governorateName && !excludeGovernorate) addressString += `${governorateName}, `;
  if (address.city) addressString += `${address.city}`;
  if (address.street) addressString += `, ${address.street}`;
  if (address.landmark) addressString += `, ${address.landmark}`;
  if (address.details) addressString += `, ${address.details}`;
  return addressString;
}
