import { useRef } from "react";

export default function useHandlePreviousFilters<T extends object>(filters: T) {
  const previousFiltersRef = useRef<T>(filters);

  // Function to check if any filter has changed
  const filtersChanged = (newFilters: T): boolean => {
    return Object.keys(newFilters).some((key) => newFilters[key as keyof T] !== previousFiltersRef.current[key as keyof T]);
  };

  // Function to update the previousFiltersRef
  const updatePreviousFilters = (newFilters: T) => {
    previousFiltersRef.current = newFilters;
  };

  // Return both the previousFiltersRef and filtersChanged
  return { filtersChanged, updatePreviousFilters };
}
