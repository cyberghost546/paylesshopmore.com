// src/components/RequireWarehouse/RequireWarehouse.jsx
import { Navigate, useLocation } from 'react-router-dom';
import Loading from '../Loading/Loading';
import { useAuth } from '../../auth/useAuth';
import { TWO_FACTOR_PATH, needsTwoFactor } from '../../auth/twoFactor';

/**
 * The guard in front of /warehouse: the floor, and the office as well.
 *
 * Office staff are let in because the intake sheets are theirs to read too,
 * and the handover e-mail links here for everybody. The server agrees -
 * IsWarehouseOrStaff is what answers every request these pages make.
 *
 * Presentation only, like RequireStaff. A customer who edits this away still
 * gets a 403 from every route behind it.
 */
export default function RequireWarehouse({ children }) {
  const { isAuthenticated, isChecking, user } = useAuth();
  const location = useLocation();

  if (isChecking) return <Loading />;

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        // The query string too: /warehouse/intake?sheet=41 from the handover
        // e-mail should still open that sheet after signing in.
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  // Signed in with a password, but the authenticator code is still to come.
  if (needsTwoFactor(user)) {
    return <Navigate to={TWO_FACTOR_PATH} replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (!user?.isStaff && !user?.isWarehouse) return <Navigate to="/" replace />;

  // A warehouse worker signed in with a password, like a customer: the
  // warehouse opens from their profile page with their e-mail and PIN. Sent
  // there with the form already open, and back here afterwards. The server
  // refuses the warehouse to this session anyway (IsWarehouseOrStaff).
  if (!user?.isStaff && !user?.warehouseUnlocked) {
    return (
      <Navigate
        to="/profile"
        replace
        state={{ openWarehouse: true, from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return children;
}
