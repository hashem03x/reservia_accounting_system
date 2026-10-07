import { Customer } from "@/types/customer";
import { Vendor } from "@/types/vendor";

export function stringifyVendorAddress(vendor: Vendor) {
  let address = "";
  if (vendor.address?.country) address += `${vendor.address.country}`;
  if (vendor.address?.city) address += `, ${vendor.address.city}`;
  if (vendor.address?.street) address += `, ${vendor.address.street}`;
  return address;
}

export function stringifyCustomerAddress(customer: Customer) {
  let address = "";
  if (customer.offlineAddress?.country) address += `${customer.offlineAddress.country}`;
  if (customer.offlineAddress?.city) address += `, ${customer.offlineAddress.city}`;
  if (customer.offlineAddress?.street) address += `, ${customer.offlineAddress.street}`;
  return address;
}
