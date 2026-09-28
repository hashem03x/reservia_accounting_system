import { useState } from "react";

export default function useFetchingStatus(initialLoading: boolean = false) {
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [error, setError] = useState<string>("");

  return { loading, setLoading, error, setError };
}
