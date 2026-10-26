export function useAuth() {
  return {
    session: { user: { id: 'synthetic-preview' } },
    profile: {
      id: 'synthetic-preview',
      full_name: 'Executive preview',
      role: 'admin',
    },
    loading: false,
    isAdmin: true,
    signOut: () => window.alert('Preview only. No account is signed in.'),
  }
}
