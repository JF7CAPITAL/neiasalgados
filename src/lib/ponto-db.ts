import { supabase } from "@/integrations/supabase/client";
import type { GalleryFace } from "@/lib/face";
import type { PontoCollaborator, TimeEntry, TimeEntryTipo } from "@/lib/ponto";

const FOTO_BUCKET = "ponto-fotos";

const COLLAB_COLUMNS =
  "id, nome, cargo, status, horario, foto_url, em_turno, ponto_habilitado, ponto_tipo_jornada, carga_horaria_minutos, tolerancia_minutos, banco_horas, biometria_consentimento_em";

export async function fetchPontoCollaborators(): Promise<PontoCollaborator[]> {
  const { data, error } = await supabase
    .from("collaborators")
    .select(COLLAB_COLUMNS)
    .is("deleted_at", null)
    .order("nome");
  if (error) throw error;
  return (data ?? []) as unknown as PontoCollaborator[];
}

export async function fetchTimeEntries(
  startDay: string,
  endDay: string,
  collaboratorId?: string,
): Promise<TimeEntry[]> {
  const start = new Date(`${startDay}T00:00:00`).toISOString();
  const end = new Date(`${endDay}T23:59:59.999`).toISOString();
  let query = supabase
    .from("time_entries")
    .select("*")
    .gte("registrado_em", start)
    .lte("registrado_em", end)
    .order("registrado_em", { ascending: false });
  if (collaboratorId) query = query.eq("collaborator_id", collaboratorId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchTodayEntries(collaboratorId: string): Promise<TimeEntry[]> {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const key = `${y}-${m}-${d}`;
  return fetchTimeEntries(key, key, collaboratorId);
}

export interface NewTimeEntry {
  collaboratorId: string;
  tipo: TimeEntryTipo;
  registradoEm?: string;
  origem?: "facial" | "manual" | "pin" | "ajuste";
  confianca?: number | null;
  dispositivo?: string | null;
  fotoPath?: string | null;
  observacoes?: string | null;
  ajusteMotivo?: string | null;
  createdBy?: string | null;
  ajustadoPor?: string | null;
}

export async function insertTimeEntry(payload: NewTimeEntry): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      collaborator_id: payload.collaboratorId,
      tipo: payload.tipo,
      registrado_em: payload.registradoEm ?? new Date().toISOString(),
      origem: payload.origem ?? "facial",
      confianca: payload.confianca ?? null,
      dispositivo: payload.dispositivo ?? null,
      foto_path: payload.fotoPath ?? null,
      observacoes: payload.observacoes ?? null,
      ajuste_motivo: payload.ajusteMotivo ?? null,
      created_by: payload.createdBy ?? null,
      ajustado_por: payload.ajustadoPor ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTimeEntry(entry: TimeEntry): Promise<void> {
  if (entry.foto_path) {
    await supabase.storage.from(FOTO_BUCKET).remove([entry.foto_path]);
  }
  const { error } = await supabase.from("time_entries").delete().eq("id", entry.id);
  if (error) throw error;
}

export async function updateCollaboratorPresence(
  collaboratorId: string,
  emTurno: boolean,
): Promise<void> {
  await supabase.from("collaborators").update({ em_turno: emTurno }).eq("id", collaboratorId);
}

export async function uploadPontoPhoto(
  collaboratorId: string,
  blob: Blob,
  kind: "batida" | "biometria",
): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const path = `${collaboratorId}/${kind}/${day}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from(FOTO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

export async function removePontoPhoto(path: string): Promise<void> {
  await supabase.storage.from(FOTO_BUCKET).remove([path]);
}

export async function getSignedPontoFotoUrl(
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FOTO_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// -------------------------------------------------------------------
// Galeria facial (cache curto para o quiosque)
// -------------------------------------------------------------------
let galleryCache: { data: GalleryFace[]; at: number } | null = null;
const GALLERY_TTL_MS = 60_000;

interface FaceGalleryRow {
  id: string;
  collaborator_id: string;
  descriptor: unknown;
  foto_path: string | null;
  collaborator: {
    nome: string;
    status: string;
    ponto_habilitado: boolean;
    deleted_at: string | null;
  } | null;
}

export async function loadFaceGallery(force = false): Promise<GalleryFace[]> {
  if (!force && galleryCache && Date.now() - galleryCache.at < GALLERY_TTL_MS) {
    return galleryCache.data;
  }

  const { data, error } = await supabase
    .from("collaborator_faces")
    .select(
      "id, collaborator_id, descriptor, foto_path, collaborator:collaborators!inner(nome, status, ponto_habilitado, deleted_at)",
    )
    .eq("ativo", true);
  if (error) throw error;

  const rows = (data ?? []) as unknown as FaceGalleryRow[];
  const gallery: GalleryFace[] = [];
  for (const row of rows) {
    const collaborator = row.collaborator;
    if (!collaborator || collaborator.deleted_at) continue;
    if (!collaborator.ponto_habilitado) continue;
    if (collaborator.status === "desligado" || collaborator.status === "inativo") continue;
    if (!Array.isArray(row.descriptor)) continue;
    gallery.push({
      faceId: row.id,
      collaboratorId: row.collaborator_id,
      collaboratorName: collaborator.nome,
      descriptor: row.descriptor as number[],
      fotoPath: row.foto_path,
    });
  }

  galleryCache = { data: gallery, at: Date.now() };
  return gallery;
}

export function invalidateFaceGallery(): void {
  galleryCache = null;
}

// -------------------------------------------------------------------
// Biometria (cadastro pelo RH)
// -------------------------------------------------------------------
export interface FaceSample {
  id: string;
  collaborator_id: string;
  descriptor: unknown;
  foto_path: string | null;
  created_at: string;
}

export async function fetchFaceSamples(collaboratorId: string): Promise<FaceSample[]> {
  const { data, error } = await supabase
    .from("collaborator_faces")
    .select("id, collaborator_id, descriptor, foto_path, created_at")
    .eq("collaborator_id", collaboratorId)
    .eq("ativo", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FaceSample[];
}

export async function saveFaceEnrollment(
  collaboratorId: string,
  samples: { descriptor: number[]; fotoBlob: Blob }[],
  userId: string | null,
): Promise<void> {
  if (!samples.length) throw new Error("Nenhuma amostra facial capturada.");

  const rows: {
    collaborator_id: string;
    descriptor: unknown;
    foto_path: string | null;
    created_by: string | null;
  }[] = [];
  const uploadedPaths: string[] = [];

  for (const sample of samples) {
    const fotoPath = await uploadPontoPhoto(collaboratorId, sample.fotoBlob, "biometria");
    uploadedPaths.push(fotoPath);
    rows.push({
      collaborator_id: collaboratorId,
      descriptor: sample.descriptor,
      foto_path: fotoPath,
      created_by: userId,
    });
  }

  const { error } = await supabase.from("collaborator_faces").insert(rows as never);
  if (error) {
    await supabase.storage.from(FOTO_BUCKET).remove(uploadedPaths);
    throw error;
  }
  invalidateFaceGallery();
}

export async function deleteFaceSample(sample: FaceSample): Promise<void> {
  if (sample.foto_path) {
    await supabase.storage.from(FOTO_BUCKET).remove([sample.foto_path]);
  }
  const { error } = await supabase.from("collaborator_faces").delete().eq("id", sample.id);
  if (error) throw error;
  invalidateFaceGallery();
}

export async function deleteAllFaceSamples(collaboratorId: string): Promise<void> {
  const samples = await fetchFaceSamples(collaboratorId);
  const paths = samples.map((s) => s.foto_path).filter((p): p is string => Boolean(p));
  if (paths.length) {
    await supabase.storage.from(FOTO_BUCKET).remove(paths);
  }
  const { error } = await supabase
    .from("collaborator_faces")
    .delete()
    .eq("collaborator_id", collaboratorId);
  if (error) throw error;
  invalidateFaceGallery();
}

export interface PontoFechamento {
  id: string;
  collaborator_id: string;
  periodo_inicio: string;
  periodo_fim: string;
  saldo_minutos: number;
  created_at: string;
}

export async function fetchPontoFechamentos(
  startDay: string,
  endDay: string,
): Promise<PontoFechamento[]> {
  const { data, error } = await supabase
    .from("ponto_fechamentos")
    .select("id, collaborator_id, periodo_inicio, periodo_fim, saldo_minutos, created_at")
    .gte("periodo_inicio", startDay)
    .lte("periodo_fim", endDay)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PontoFechamento[];
}

export async function closePontoPeriod(
  collaboratorId: string,
  startDay: string,
  endDay: string,
  saldoMinutes: number,
  userId: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc("fechar_ponto_periodo", {
    _collaborator_id: collaboratorId,
    _inicio: startDay,
    _fim: endDay,
    _saldo_minutos: Math.round(saldoMinutes),
    _user_id: userId,
  } as never);
  if (error) {
    if (error.code === "23505") {
      throw new Error("Esta competência já foi fechada para este colaborador.");
    }
    throw error;
  }
  return Number(data) || 0;
}

export async function fetchEnrolledCollaboratorIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("collaborator_faces")
    .select("collaborator_id")
    .eq("ativo", true);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.collaborator_id));
}

export async function registerBiometricConsent(
  collaboratorId: string,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("collaborators")
    .update({
      biometria_consentimento_em: new Date().toISOString(),
      biometria_consentimento_por: userId,
    })
    .eq("id", collaboratorId);
  if (error) throw error;
}
