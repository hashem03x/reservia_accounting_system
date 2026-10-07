import { useState } from "react";
import usePrivateRequest from "@/hooks/usePrivateRequest";

export default function useDataHandler<T>({
  initialData,
  initialLoading = false,
}: {
  initialData: T;
  initialLoading?: boolean;
}) {
  const privateRequest = usePrivateRequest();

  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [error, setError] = useState<string>("");

  const [data, setData] = useState<T>(initialData);

  return { privateRequest, loading, setLoading, error, setError, data, setData };
}
