import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { RoleName } from "@sdc/shared";
import { useAuth } from "@/context/auth";
import { homePathFor } from "./paths";

export const FullPageSpinner = () => (
  <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading"><Loader2 className="size-8 animate-spin text-brand-600" /></div>
);

/** UX-only gate; the API enforces permissions on every request. */
export function RequireRole({ roles, children }: { roles: RoleName[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <>{children}</>;
}
