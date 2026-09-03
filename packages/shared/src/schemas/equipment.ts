import { z } from "zod";
import { EquipmentType } from "../enums";

const trailerLengthFt = z.coerce.number().int().min(1).max(100);
const capacityLbs = z.coerce.number().int().min(0).max(200_000);

export const createEquipmentSchema = z
  .object({
    type: z.nativeEnum(EquipmentType),
    name: z.string().trim().min(1).max(120).optional(),
    trailerLengthFt: trailerLengthFt.optional(),
    capacityLbs: capacityLbs.optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

export const updateEquipmentSchema = z
  .object({
    type: z.nativeEnum(EquipmentType).optional(),
    name: z.string().trim().min(1).max(120).nullable().optional(),
    trailerLengthFt: trailerLengthFt.nullable().optional(),
    capacityLbs: capacityLbs.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
