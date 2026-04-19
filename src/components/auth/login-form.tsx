"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import {
  loginSchema,
  magicLinkSchema,
  type LoginFormData,
  type MagicLinkFormData,
} from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const passwordForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const magicForm = useForm<MagicLinkFormData>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: "" },
  });

  async function onPasswordLogin(data: LoginFormData) {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function onMagicLink(data: MagicLinkFormData) {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: data.email,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setMagicLinkSent(true);
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <Image
          src="/Duraska_logo_white.svg"
          alt="Duraska"
          width={240}
          height={240}
          className="mx-auto mb-4 h-[240px] w-[240px]"
        />
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-6">
        <Tabs defaultValue="password">
          <TabsList className="grid w-full grid-cols-2 bg-secondary">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
          </TabsList>

          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          <TabsContent value="password">
            <form
              onSubmit={passwordForm.handleSubmit(onPasswordLogin)}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="bg-secondary/50"
                  {...passwordForm.register("email")}
                />
                {passwordForm.formState.errors.email && (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  className="bg-secondary/50"
                  {...passwordForm.register("password")}
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-xs text-destructive">
                    {passwordForm.formState.errors.password.message}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={passwordForm.formState.isSubmitting}
              >
                {passwordForm.formState.isSubmitting
                  ? "Signing in..."
                  : "Sign in"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="magic-link">
            {magicLinkSent ? (
              <div className="rounded-lg bg-primary/10 px-3 py-4 text-center text-sm text-primary">
                Check your email for a sign-in link.
              </div>
            ) : (
              <form
                onSubmit={magicForm.handleSubmit(onMagicLink)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="magic-email">Email</Label>
                  <Input
                    id="magic-email"
                    type="email"
                    placeholder="you@example.com"
                    className="bg-secondary/50"
                    {...magicForm.register("email")}
                  />
                  {magicForm.formState.errors.email && (
                    <p className="text-xs text-destructive">
                      {magicForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={magicForm.formState.isSubmitting}
                >
                  {magicForm.formState.isSubmitting
                    ? "Sending..."
                    : "Send magic link"}
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary hover:underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
