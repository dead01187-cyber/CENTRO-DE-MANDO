# Fase Anna 4: Marki con voz (solo investigación, no construido)

Precios revisados el 25 de noviembre de 2026 en las páginas oficiales de ElevenLabs y Vonage. Cambian seguido: confírmalos antes de contratar.

## Cómo funciona hoy
- Marki marca **dando clic en el marcador de Lofty**, y quien habla eres tú. La API de Lofty no permite hacer llamadas.
- La idea es que, al contestar el lead, hable un **agente de voz de IA en ElevenLabs** ("Mark"). El agente califica al lead (cuándo, por qué, precio, agente) y te lo pasa si está caliente.

## Las piezas
1. **El agente (ElevenLabs Agents)**: la voz, el guion y la IA que platica. Cuesta **$0.08 por minuto** en todos los planes, más el modelo de IA: de ~$0.001 a ~$0.03 por minuto (con un modelo tipo Claude Sonnet, unos $0.026 por minuto).
   - Planes: Creator $22 al mes (275 minutos, 10 llamadas a la vez), Pro $99 al mes (1,238 minutos, 20 a la vez).
   - Lo que pasa del límite de llamadas a la vez cuesta $0.16 por minuto.
2. **La línea telefónica** con número de California. Hay tres maneras de conectarla:

| Opción | Cómo se conecta | ¿Necesita servidor propio? | Costo de la línea | Notas |
|---|---|---|---|---|
| **A. Twilio** (recomendada para empezar) | Integración nativa: se importa el número en ElevenLabs | **No** | Número local ~$1.15 al mes; ~$0.014 por minuto de salida | La más sencilla. Las llamadas se lanzan por API o por "Batch calling" |
| **B. Vonage Voice API** (la API de Vonage, no la app de Vonage Business) | Un "conector" (programa Node.js) entre Vonage y ElevenLabs | **Sí**: hay que tenerlo prendido en internet (Vonage Cloud Runtime u otro hosting) | ~$0.0085 por minuto de salida en EE. UU., cobrado por segundo; el número se cobra aparte | Más barata por minuto, pero hay que mantener un servidor |
| **C. Vonage SIP Trunk** | ElevenLabs llama por el "SIP trunk" de Vonage | No | ~$24.99 por línea al mes, sin importar los minutos | ElevenLabs dice que es compatible con Vonage. La configuración SIP suele dar guerra; hay que confirmarla con el soporte de Vonage |

**Ojo con Vonage Business Communications** (la app de teléfono por usuario, de $13.99 a $39.99 al mes): **no se conecta directo** a un agente de IA. Para eso hace falta su Voice API (opción B) o su SIP Trunk (opción C). El número de CA que ya tengas en Vonage Business se puede usar para que **el agente te pase la llamada a ti** cuando el lead esté caliente.

## Cómo se conectaría al Centro de Mando (sin servidor, con la opción A o C)
1. Rayo o Marki eligen al lead. El **Cerebro** revisa las reglas: 24 h, horario de 8 am a 9 pm, persona, Anna y DNC.
2. La extensión le pide a ElevenLabs que llame: `POST /v1/convai/twilio/outbound-call` (o `/sip-trunk/outbound-call`), con el nombre y la ciudad del lead.
3. Al terminar, la extensión lee el resultado con `GET /v1/convai/conversations/{id}` (transcripción, resumen y datos que pediste: cuándo, por qué, precio, agente).
4. Deja una **nota en inglés** en Lofty, **sugiere** la etapa (Hot o Warm, con tu clic) y te avisa por Capi si está caliente.
5. Si el lead pide hablar con alguien o está caliente, el agente **te transfiere la llamada** a tu número.
6. Si la llamada cae en buzón, puede dejar un mensaje corto o colgar.

La llave de ElevenLabs ya se guarda en la configuración (`elKey`). Faltaría el número y el ID del agente; nada va en el código.

## Costo estimado al mes
Supuesto: unas 600 llamadas al mes con ~1.5 min de promedio (la mayoría buzón o no contesta) = **~900 minutos**.

| Concepto | Opción A (Twilio) | Opción C (Vonage SIP) |
|---|---|---|
| ElevenLabs ($0.08/min) | ~$72 (plan Creator + extras) | ~$72 |
| IA (modelo económico / Claude) | $1 – $25 | $1 – $25 |
| Línea | ~$13 + $1.15 del número | ~$25 por línea |
| **Total** | **~$90 – $110 al mes** | **~$100 – $125 al mes** |

Con el doble de llamadas, el costo sube a ~$180–220. Hay que comparar contra lo que cuesta Anna en Lofty y contra tu tiempo marcando.

## Lo legal (importante, consultar con abogado)
- **TCPA:** la FCC decidió en febrero de 2024 que una voz de IA cuenta como **"voz artificial"**. Para llamar a un celular hace falta **consentimiento previo expreso del lead**, y para marketing la regla de la FCC lo pide **por escrito**. Una corte federal (5º Circuito, 2026) dijo que basta el consentimiento oral, pero otras cortes y California pueden ser más estrictas. Multa: **$500 a $1,500 por llamada**.
  - Los leads de **zBuyer** llenaron un formulario. Hay que revisar si el texto de consentimiento de zBuyer cubre llamadas con voz artificial de tu empresa.
  - Los leads de Propwire, Lofti o listas compradas **no tienen ese consentimiento**: para ellos, Marki sigue con **tu voz**, como hoy.
- **California:** las llamadas con voz artificial deben **avisar que lo son** (AB 2905, desde 2025), y un bot no puede hacerse pasar por persona (SB 1001). El agente debería decir algo como *"Hi, this is Mark's AI assistant with Rubio Real Estate…"* y contestar con la verdad si le preguntan.
- **Siempre:** horario de 8 am a 9 pm, respetar DNC y "no llamar", ofrecer cómo darse de baja y avisar que la llamada se graba.
- **Reputación del número:** registrar el número (STIR/SHAKEN y el registro de identificador) y no hacer demasiadas llamadas por número al día, para que no salga como "Spam Likely".

## Recomendación
1. Empezar con la **opción A (Twilio + ElevenLabs)**: es la única sin servidor y se puede probar en un día. Primero en modo prueba, llamándote a ti.
2. Usar la voz de IA **solo con leads nuevos de zBuyer con consentimiento**, y que se presente como asistente de IA.
3. Si funciona y quieres todo en Vonage, pasar después a la opción C (SIP de Vonage) o B (Voice API con conector).
4. Anotar las llamadas en el Cerebro (canal "llamada") para que el Marcador las cuente contra Anna.

## Fuentes
- ElevenLabs Agents, precios: https://elevenlabs.io/pricing/agents
- ElevenLabs + Twilio: https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration
- ElevenLabs + Vonage: https://elevenlabs.io/docs/eleven-agents/phone-numbers/telephony/vonage
- ElevenLabs SIP trunking: https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking
- Batch calling: https://elevenlabs.io/docs/eleven-agents/phone-numbers/batch-calls
- Vonage Voice API, precios: https://www.vonage.com/communications-apis/voice/pricing/
- Vonage Business, planes: https://www.vonage.com/unified-communications/pricing/
- FCC, voces de IA y TCPA (FCC-24-17): https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices
