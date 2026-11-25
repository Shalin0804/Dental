import { useQuery } from "@tanstack/react-query";
import type { Faq, PublicDoctor, PublicReview, PublicTreatment, SiteContent } from "@sdc/shared";
import { api } from "./api";

type Data<T> = { data: T };
const get = <T,>(path: string) => () => api<Data<T>>(path).then((r) => r.data);

export const useSite = () => useQuery({ queryKey: ["public", "site"], queryFn: get<SiteContent>("/public/site"), staleTime: 5 * 60_000 });
export const useTreatments = () => useQuery({ queryKey: ["public", "treatments"], queryFn: get<PublicTreatment[]>("/public/treatments") });
export const useTreatment = (slug: string) => useQuery({ queryKey: ["public", "treatments", slug], queryFn: get<PublicTreatment & { doctors: PublicDoctor[] }>(`/public/treatments/${slug}`) });
export const useDoctors = () => useQuery({ queryKey: ["public", "doctors"], queryFn: get<PublicDoctor[]>("/public/doctors") });
export const useDoctor = (slug: string) => useQuery({ queryKey: ["public", "doctors", slug], queryFn: get<PublicDoctor & { reviews: PublicReview[] }>(`/public/doctors/${slug}`) });
export const useReviews = () => useQuery({ queryKey: ["public", "reviews"], queryFn: get<PublicReview[]>("/public/reviews") });
export const useFaqs = () => useQuery({ queryKey: ["public", "faqs"], queryFn: get<Faq[]>("/public/faqs") });
