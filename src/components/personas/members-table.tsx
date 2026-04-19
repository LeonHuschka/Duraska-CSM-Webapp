"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PERSONA_ROLES } from "@/lib/constants";
import {
  updateMemberRole,
  removeMember,
} from "@/app/(app)/settings/personas/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InviteMemberDialog } from "./invite-member-dialog";

interface Member {
  userId: string;
  role: string;
  fullName: string;
  avatarUrl: string | null;
}

interface MembersTableProps {
  personaId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
}

export function MembersTable({
  personaId,
  members,
  currentUserId,
  canManage,
}: MembersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);

  function handleRoleChange(userId: string, newRole: string) {
    startTransition(async () => {
      const result = await updateMemberRole(personaId, userId, newRole);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Role updated");
      router.refresh();
    });
  }

  function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from this persona?`)) return;
    startTransition(async () => {
      const result = await removeMember(personaId, userId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} removed`);
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              {members.length} member{members.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="h-4 w-4" />
              Invite
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {member.fullName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{member.fullName}</p>
                    {member.userId === currentUserId && (
                      <p className="text-xs text-muted-foreground">You</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && member.userId !== currentUserId ? (
                    <>
                      <Select
                        value={member.role}
                        onValueChange={(value) =>
                          handleRoleChange(member.userId, value)
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PERSONA_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              <span className="capitalize">{role}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          handleRemove(member.userId, member.fullName)
                        }
                        disabled={isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm capitalize text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <InviteMemberDialog
        personaId={personaId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </>
  );
}
