"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ABOUT_FAQS } from "@/lib/seo/about-copy";

export function AboutFaqAccordion() {
  return (
    <Accordion type="multiple" className="w-full border-t border-zinc-200">
      {ABOUT_FAQS.map((faq, index) => (
        <AccordionItem key={faq.question} value={`faq-${index}`}>
          <AccordionTrigger>{faq.question}</AccordionTrigger>
          <AccordionContent>{faq.answer}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
