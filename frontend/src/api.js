const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export async function apiRequest(path, options = {}) {
  const { auth = true, ...request } = options;

  const token = sessionStorage.getItem("millet_access_token");
  const headers = new Headers(request.headers || {});

  if (
    request.body &&
    !(request.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (auth && token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...request,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.detail;

    const message =
      typeof detail === "string"
        ? detail
        : typeof detail?.message === "string"
          ? detail.message
          : Array.isArray(detail)
            ? detail
                .map(
                  (item) =>
                    `${item.loc?.slice(1).join(".") || "Input"}: ${item.msg}`,
                )
                .join("; ")
            : "Request failed. Please try again.";

    const error = new Error(message);

    error.status = response.status;
    error.code = detail?.code ?? null;
    error.detail = detail;

    throw error;
  }

  return data;
}

export function dashboardPath(role) {
  return (
    {
      farmer: "/farmer/dashboard",
      buyer: "/buyer/dashboard",
      admin: "/admin/dashboard",
    }[role] || "/login"
  );
}