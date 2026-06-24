'use client';
// Unified into the single /login page — redirect any old links here.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OwnerLoginRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/login'); }, [router]);
  return null;
}
