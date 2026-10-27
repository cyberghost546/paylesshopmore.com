// src/components/RequireAuth/RequireAuth.jsx
import { Navigate, useLocation } from 'react-router-dom';
import Loading from '../Loading/Loading';
import { useAuth } from '../../auth/useAuth';
import { TWO_FACTOR_PATH, needsTwoFactor } from '../../auth/twoFactor';

/**
 * Sends signed-out visitors to the login page.
 *
 * This is a convenience, not a security boundary — anyone can edit the
 * JavaScript in their own browser. What actually protects the data is the API
 * returning 401/403, which it does regardless of what this component renders.
 */
export default function RequireAuth({ children }) {
  const { isAuthenticated, isChecking, user } = useAuth();
  const location = useLocation();

  // Redirecting before the session check answers would bounce a signed-in
  // visitor to the login page every time they refresh.
  if (isChecking) return <Loading />;

  if (!isAuthenticated) {
    // `replace` keeps the guarded page out of history, so Back does not land
    // on it again. `state.from` lets the login page return them here after -
    // to the same card, too: /profile#tracking should not come back as the
    // top of the profile.
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search + location.hash }}
      />
    );
  }

  // Signed in with a password, but the authenticator code is still to come.
  if (needsTwoFactor(user)) {
    return <Navigate to={TWO_FACTOR_PATH} replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  return children;
}
