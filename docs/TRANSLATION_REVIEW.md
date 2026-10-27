# Translations to check

Texts added in October 2026 that were translated without a native speaker.
Please check the **Papiamentu** in particular, and the **English** of the terms
clause (it is legal text). Mark anything that sounds wrong and write the
better wording next to it.

Already checked: the Papiamentu below uses the same words as the rest of
the site ("pre-alerta", "ofèrta", "enbio", "pakus", "remitente", "purba
atrobe").

## 1. Booking form – the terms clause (legal text)

Shown above the "I agree" tick box on the booking page. The Dutch is the
original from the paper form.

| | Text |
|---|---|
| Dutch (original) | **BELANGRIJK!** De afzender gaat akkoord met de algemene voorwaarden. |
| English | **IMPORTANT!** The sender agrees to the terms and conditions. |
| Papiamentu | **IMPORTANTE!** E remitente ta di akuerdo ku e kondishonnan general. |
| Dutch (original) | PAY LESS SHOP MORE is niet verantwoordelijk voor de inhoud en waarde van de colli en kan op geen enkele wijze hiervoor aansprakelijk worden gesteld. De opgegeven waarde zal worden gebruikt door de douane voor berekening van de invoerrechten. U bent zelf verantwoordelijk voor deze waarde en indien de douane het niet eens is met de opgegeven waarde, zullen zij deze herzien. Het is strafbaar verboden items te transporteren. |
| English | PAY LESS SHOP MORE is not responsible for the contents and value of the packages and cannot be held liable for them in any way. The declared value will be used by customs to calculate import duties. You are responsible for this value yourself, and if customs does not agree with the declared value, they will revise it. Transporting prohibited items is a criminal offence. |
| Papiamentu | PAY LESS SHOP MORE no ta responsabel pa e kontenido i balor di e pakete(nan) i no por wòrdu tené responsabel pa esaki di ningun manera. Doana lo usa e balor deklará pa kalkulá e derechi di importashon. Bo mes ta responsabel pa e balor aki, i si doana no ta di akuerdo ku e balor deklará, nan lo revisá esaki. Transportá artíkulonan prohibí ta kastigabel pa lei. |
| Dutch (original) | De afzender gaat ermee akkoord dat de goederen niet verzekerd zijn, tenzij tegen betaling een losse verzekering wordt afgesloten. Glas en geperst houten items altijd uitgesloten. |
| English | The sender agrees that the goods are not insured unless separate insurance is taken out for a fee. Glass and pressed-wood items are always excluded. |
| Papiamentu | E remitente ta di akuerdo ku e mercancia no ta sigurá, ku eksepshon si un seguro separá ta wòrdu sera kontra pago. Glas i artíkulonan di palu prensá semper ta eksklui. |

**Also to decide:** if the Dutch version is the binding one, add a line
saying so under the translated versions.

## 2. The chat assistant (the robot's panel, every page)

| English (meaning) | Papiamentu |
|---|---|
| Ask our assistant | Hasi bo pregunta na nos asistente |
| Back to help | Bèk na yudansa |
| Assistant | Asistente |
| Questions, shipping costs and help with booking | Preguntanan, kosto di manda i yudansa ku reservá |
| Hello! I am the Pay Less Shop More assistant. I can answer questions, work out shipping costs and help you fill in the booking form. How can I help? | Halo! Mi ta e asistente di Pay Less Shop More. Mi por kontestá preguntanan, kalkulá kosto di manda i yuda bo yena e formulario di reservashon. Kon mi por yuda bo? |
| Where is my parcel? | Unda mi pakete ta? |
| What does shipping to Curaçao cost? | Kuantu e ta kosta pa manda pa Kòrsou? |
| Help me fill in the booking form | Yuda mi yena e formulario di reservashon |
| How does it work? | Kon e ta funshoná? |
| Type your question… | Skirbi bo pregunta… |
| Send | Manda |
| The assistant is writing an answer | E asistente ta skirbiendo un kontesta |
| Answers are written by AI and may contain mistakes. Prices are an indication. | AI ta skirbi e kontestanan i nan por kontené fout. Preisnan ta un indikashon. |
| You have asked a lot of questions. Please try again in a while, or contact us. | Bo a hasi hopi pregunta. Purba atrobe despues di un ratu, òf tuma kontakto ku nos. |
| The assistant cannot answer right now. Please try again later, or contact us. | E asistente no por kontestá awor. Purba atrobe mas lat, òf tuma kontakto ku nos. |

The assistant's own answers are written by the AI in the language the
visitor uses, so they are not in this list.

## 3. Pre-alert page – "fill it in from a screenshot"

| English (meaning) | Papiamentu |
|---|---|
| Quicker: fill it in from a screenshot | Mas lihé: yena e ku un screenshot |
| Upload a screenshot or PDF of the webshop's order confirmation or shipping e-mail. We fill in the form for you; you check it afterwards. | Upload un screenshot òf PDF di e konfirmashon di òrdu òf e e-mail di embarke di e webshop. Nos ta yena e formulario pa bo; bo ta kontrolá e despues. |
| Choose screenshot | Skohe screenshot |
| Reading… | Lesando… |
| Filled in from your screenshot. Check everything before you send. | Yená for di bo screenshot. Kontrolá tur kos promé ku bo manda. |
| We could not find anything useful in this file. Please fill in the form yourself. | Nos no por a haña nada útil den e archivo aki. Por fabor yena e formulario bo mes. |
| The file could not be read just now. Please fill in the form yourself. | E archivo no por a wòrdu lesá awor. Por fabor yena e formulario bo mes. |

## 4. Office dashboard (staff only)

Less urgent: only staff see these, and the dashboard is used mostly in
Dutch and English.

| English (meaning) | Papiamentu |
|---|---|
| Daily summary | Resumen di dia |
| Start with | Kuminsá ku |
| Yesterday | Ayera |
| Shipments that need somebody | Enbionan ku mester di un hende |
| New bookings / messages / quote requests / pre-alerts | Reservashon nobo / Mensahe nobo / Petishon di ofèrta nobo / Pre-alerta nobo |
| Pre-alerted, arrived | Pre-alertá, a yega |
| This summary is also e-mailed every morning. | E resumen aki ta wòrdu mandá pa e-mail tambe tur mainta. |
| Write with AI | Skirbi ku AI |
| A first draft in their language. Fill in the [price] and anything else in [brackets], then send. | Un promé version den nan idioma. Yena e [preis] i tur kos entre [hakchi], i manda. |
| Answer / Send answer | Kontesta / Manda kontesta |
| Choose file / No file chosen | Skohe archivo / No a skohe archivo |

## 4a. Office dashboard – customs paperwork check

The full list (about 25 sentences) is in `frontend/src/i18n/pages/packages.js`
under `customs`. The main ones:

| English (meaning) | Papiamentu |
|---|---|
| Customs check | Kontrol di doana |
| Not ready for customs | No ta kla pa doana |
| Check before it leaves | Kontrolá promé ku e sali |
| Paperwork complete | Papelnan kompleto |
| No invoice, receipt or order confirmation. Customs needs an invoice for new goods, or an itemised packing list with values for used goods. | No tin faktura, risibu òf konfirmashon di òrdu. Doana ta pidi un faktura pa mercancia nobo, òf un lista di empake detayá ku balor pa mercancia usá. |
| Booked as emigration (duty-free), but something is missing: | Reservá komo emigrashon (liber di derechi), pero algu ta falta: |

## 4b. Warehouse intake sheet – reading a label with AI

| English (meaning) | Papiamentu |
|---|---|
| Reading the label with AI… | E etiket ta wòrdu lesá ku AI… |
| Filled in by AI: {fields}. Check them before you release the sheet. | Yená pa AI: {fields}. Kontrolá nan promé ku bo libra e formulario. |
| The AI could not find anything to fill in. Tap the lines below instead. | E AI no a haña nada pa yena. Toka e liñanan aki bou. |
| Tracking number: {number} | Number di tracking: {number} |
| AI is not available right now, so the label was read on this device. Tap the lines below. | AI no ta disponibel awor, p'esei e etiket a wòrdu lesá riba e aparato aki. Toka e liñanan aki bou. |
| Our shipment {number} · {customer} | Nos enbio {number} · {customer} |
| Pre-alerted · {customer} | Pre-alertá · {customer} |
| Customer {code} · {customer} | Kliente {code} · {customer} |

(`{fields}`, `{number}` and the like are filled in by the site: leave them as they are.)

## 5. E-mail subject sent to customers

| English | Papiamentu |
|---|---|
| Re: Your quote request - Curaçao | Re: Bo petishon di ofèrta - Curaçao |

(The island's name is copied from the request as the customer sent it.)

## Where the texts live (for whoever makes the changes)

- Booking terms, chat, pre-alert: `frontend/src/i18n/translations.js`
  (keys `booking.termsClause`, `chat`, `prealert.read`)
- Daily summary: `frontend/src/i18n/dashboardTranslations.js`
  (`office.overview.summary`)
- Quote answers: `frontend/src/i18n/pages/quotes.js` (`answer`)
- Message drafts: `frontend/src/i18n/pages/messages.js` (`draft…`)
- File picker: `frontend/src/i18n/pages/documentReview.js`
- E-mail subject: `backend/enquiries/replies.py` (`WORDING`)
