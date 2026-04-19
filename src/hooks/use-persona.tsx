"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PersonaWithRole } from "@/lib/types/database";

type PersonaContextValue = {
  activePersona: PersonaWithRole;
  personas: PersonaWithRole[];
};

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PersonaContextValue;
}) {
  return (
    <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>
  );
}

export function usePersona() {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used within PersonaProvider");
  return ctx;
}
