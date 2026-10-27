// src/data/terms.js
//
// The Terms & Conditions shown at /terms (src/pages/Terms): the Forwarding
// Conditions and the Warehousing Conditions.
//
// IN ENGLISH ONLY, ON PURPOSE. These are legal texts, and they state
// themselves that the Dutch text prevails over the English. They are shown
// exactly as supplied (only the company name and the contact details were
// changed to Pay Less Shop More); the page tells every visitor, in their own
// language, that the Dutch text is decisive. Do not machine-translate them.
//
// HOW AN ARTICLE IS WRITTEN HERE
//   number     shown before the title ("Article 4", "Section 7")
//   title
//   paragraphs a list. A string is a paragraph; { text, items } is a
//              paragraph followed by a bullet list (text may be '').
//              When an Article has more than one paragraph they are numbered
//              1, 2, 3... on the page (the Forwarding Conditions refer to
//              them as "paragraph 3" etc.). Set `numbered: false` on an
//              article to switch that off (the Warehousing Conditions carry
//              their own numbers, like "7.1", in the text).
//
// A list item can itself be { text, items } (a sub-list), and a paragraph
// with `lettered: true` shows its list as a., b., c. (Section 37.1 of the
// Warehousing Conditions refers to "paragraphs d. and e.").
//
// Typing errors in the source text (e.g. "shall the deemed" in 26.3) are
// kept as they were: this is the text that was published, word for word.

export const FORWARDING = {
  id: 'forwarding',
  title: 'Forwarding Conditions Pay Less Shop More',
  groups: [
    {
      heading: 'Definitions',
      articles: [
        {
          number: 1,
          title: 'Definitions',
          paragraphs: [
            {
              text: 'In these Conditions, the following terms shall have the following meanings:',
              items: [
                'Third party/parties: all of those persons, who are not employees, with whom the Freight Forwarder has an undertaking on behalf of the Client, irrespective of whether the Freight Forwarder has the undertaking in its own name or in the name of the Client;',
                'Services: all activities and work, in any form and by whatever name, including those performed by the Freight Forwarder for or on behalf of the Client;',
                'Freight Forwarder: the natural or legal person who performs Services on behalf of the Client and who uses these Conditions; this person is not exclusively understood to be the Freight Forwarder referred to in Book 8 of the Dutch Civil Code;',
                'Client: every natural or legal person who provides the Freight Forwarder with an order to perform Services and concludes to that effect the Agreement, irrespective of the agreed method of payment;',
                'Agreement: the agreement entered into by the Freight Forwarder and Client in respect of the Services to be performed by the Freight Forwarder, of which these Conditions form part;',
                'Force majeure: all circumstances that the Freight Forwarder has reasonably been unable to avoid and in respect of which the Freight Forwarder has reasonably been unable to prevent the consequences;',
                'Conditions: these Dutch Forwarding Conditions.',
                'Good/Goods: the goods to be made available or made available to the Freight Forwarder, its agent or Third Parties by or on behalf of the Client, for the purpose of executing the Agreement.',
              ],
            },
          ],
        },
      ],
    },
    {
      heading: 'Scope',
      articles: [
        {
          number: 2,
          title: 'Scope',
          paragraphs: [
            'These Conditions govern all offers, agreements, legal acts and actual acts relating to Services to be performed by the Freight Forwarder, insofar as these are not subject to imperative law. These Conditions apply to the legal relationship between the parties, including once the Agreement has ended.',
            'Insofar as any provision in these Conditions is void or otherwise unenforceable, this does not affect the validity of the other provisions in these Conditions. Furthermore, considered to be applicable is such a stipulation (legally permissible) that is the closest to the purport of the void or voided stipulation.',
            'In case the English translation differs from the Dutch text, the latter will prevail.',
          ],
        },
        {
          number: 3,
          title: 'Third Parties',
          paragraphs: [
            'The Client gives the Freight Forwarder free rein to engage the services of Third Parties to execute the Agreement, and to accept the (general) terms and conditions of those Third Parties at the Client’s expense and risk, unless agreed otherwise with the Client. At the Client’s request, the Freight Forwarder is obliged to provide (a copy of) the (general) terms and conditions under which it has entered into a contract with those Third Parties.',
          ],
        },
      ],
    },
    {
      heading: 'Conclusion of the Agreement',
      articles: [
        {
          number: 4,
          title: 'Conclusion of the Agreement',
          paragraphs: [
            'All offers made by the Freight Forwarder are non-binding.',
            'Agreements, as well as amendments of and additions to these agreements, shall only become effective if and insofar as the Freight Forwarder has confirmed these in writing or the Freight Forwarder has started to perform the Services.',
          ],
        },
      ],
    },
    {
      heading: 'Customs work',
      articles: [
        {
          number: 5,
          title: 'Customs work',
          paragraphs: [
            'The provision of information to the Freight Forwarder, that is reasonably provided to enable customs formalities to be carried out, shall imply an order, unless otherwise agreed in writing.',
            'This order is accepted by the Freight Forwarder by means of an explicit written confirmation or by the Freight Forwarder starting to carry out the customs formalities. The Freight Forwarder is never obliged to accept an order to carry out customs formalities.',
            'If the Freight Forwarder becomes familiar with information or conditions which would indicate that the Client has not complied with article 9 paragraph 3 of these Conditions (has provided incorrect and/or incomplete information and/or documents) and on the basis of which the Freight Forwarder has not accepted the order to carry out customs formalities, the Freight Forwarder is at all times entitled to end this order and not carry this out (any further), which may or may not be set out in an additional agreement and/or authorisation, without any obligation to pay damages.',
          ],
        },
      ],
    },
    {
      heading: 'Remunerations and other costs',
      articles: [
        {
          number: 6,
          title: 'Remunerations',
          paragraphs: [
            'All prices quoted shall be based on the prices that apply at the time of the offer (quotation). If between the time of the offer and the time of execution of the Agreement, one or more of the cost factors (including fees, wages, the cost of social measures and/or laws, freight prices and exchange rates, etc.) increase, the Freight Forwarder is entitled to pass on this increase to the Client. The Freight Forwarder must be able to prove the changes.',
            'If the Freight Forwarder charges all-in or fixed rates, these rates shall be deemed to include all costs that, in the normal process of handling the order, are for the account of the Freight Forwarder.',
            'Unless provided otherwise, all-in or fixed rates shall not include at any rate: duties, taxes and levies, consular and attestation fees, costs of preparing bank guarantees and insurance premiums.',
            'In the event of circumstances that are of such a nature that when concluding the Agreement it was not deemed necessary to take into account the risk that they could occur, that cannot be attributed to the Freight Forwarder and that significantly increase the costs of the Services being performed, the Freight Forwarder is entitled to an additional payment. Where possible, the Freight Forwarder shall consult in advance with the Client. In such a case, the additional payment shall consist of the additional costs that the Freight Forwarder has had to incur in order to perform the Services, plus an additional payment – deemed fair and equitable – for the services to be performed by the Freight Forwarder.',
            'Expenses of an exceptional nature and higher wages arising whenever Third Parties, by virtue of any provision in the relevant agreements between the Freight Forwarder and Third Parties, load or unload goods in the evening, at night, on Saturdays or on Sundays or public holidays in the country where the Service is being carried out, shall not be included in the agreed prices, unless specifically stated. Any such costs shall therefore be remunerated by the Client to the Freight Forwarder.',
            'Other than in cases of intent or deliberate recklessness on the part of the Freight Forwarder, in the event of the loading and/or unloading time being inadequate, all costs resulting therefrom, such as demurrage, waiting times, etc. shall be borne by the Client, even when the Freight Forwarder has accepted the bill of lading and/or the charter party from which the additional costs arise without protestation. The Freight Forwarder must make every effort to avoid these costs.',
          ],
        },
      ],
    },
    {
      heading: 'Insurance',
      articles: [
        {
          number: 7,
          title: 'Insurance',
          paragraphs: [
            'Insurance of any kind shall only be arranged at the Client’s expense and risk following acceptance by the Freight Forwarder of the Client’s explicit written order, in which the Client clearly specifies the goods to be insured and the value to be insured. A mere statement of the value or the interest is not enough.',
            'The Freight Forwarder will take out the insurance (or arrange for this to be taken out) through an insurer / insurance broker / insurance intermediary. The Freight Forwarder is neither responsible nor liable for the solvency of the insurer / insurance broker / insurance intermediary.',
            'When the Freight Forwarder uses equipment, such as derricks, cranes, fork-lift trucks and other machines to perform the Services that do not form part of its usual equipment, the Freight Forwarder shall be entitled to take out insurance at the Client’s expense to cover the Freight Forwarder’s risks arising from the use of such equipment. Where possible, the Freight Forwarder shall consult in advance with the Client about the use of such equipment. If no timely prior consultation is possible, the Freight Forwarder will take the measures that seem to it to be in the best interests of the Client and shall inform the Client of that.',
          ],
        },
      ],
    },
    {
      heading: 'Execution of the Agreement',
      articles: [
        {
          number: 8,
          title: 'Delivery date, method of delivery and route',
          paragraphs: [
            'The mere statement by the Client of a time for delivery shall not legally bind the Freight Forwarder. Arrival times are not strict deadlines and are not guaranteed by the Freight Forwarder, unless agreed otherwise in writing.',
            'If the Client has not given any specific instructions about this with its order, the method of delivery and route shall be at the Freight Forwarder’s discretion and the Freight Forwarder may at all times accept the documents customarily used by the firms it contracts for the purpose of carrying out its orders.',
          ],
        },
        {
          number: 9,
          title: 'Commencement of the Services',
          paragraphs: [
            'The Client is obliged to deliver the Goods to the Freight Forwarder or a Third Party in suitable packaging to the agreed location, at the agreed time and in the manner agreed.',
            'In respect of the Goods, as well as in respect of the handling thereof, the Client is obliged to supply the Freight Forwarder in good time with any details and documents that it knows or ought to know, are of importance to the Freight Forwarder. If the Goods and/or activities are subject to governmental provisions, including customs and excise regulations and tax rules, the Client must provide all information and documents, in good time, that are required by the Freight Forwarder in order to comply with those provisions.',
            'The Client guarantees that the information and documents that it provides are correct and complete and that all instructions and Goods that are made available comply with current legislation. The Freight Forwarder shall not be obliged but shall be entitled to investigate whether the information provided is correct and complete.',
          ],
        },
        {
          number: 10,
          title: 'Goods Handling',
          paragraphs: [
            'All operations such as inspecting, sampling, taring, tallying, weighing, measuring, etc. and receiving goods subject to appraisal by a court-appointed expert, shall take place only on the Client’s specific instructions and upon remuneration of the costs thereof.',
            'Notwithstanding the provisions in paragraph 1, the Freight Forwarder shall be entitled, but not obliged, on its own authority and at the Client’s expense and risk, to take all such actions as it deems necessary in the Client’s interest. Where possible, the Freight Forwarder shall consult in advance with the Client. If this is not possible, the Freight Forwarder shall take the measures that seem to it to be in the best interests of the Client and shall inform the Client of the measures taken and the associated costs, as soon as this is reasonably possible.',
            'The Freight Forwarder is not an expert with respect to the Goods. The Freight Forwarder shall therefore in no way be liable for any damage that arises from or that is related to any notification by the Freight Forwarder with regard to the state, nature or quality of the Goods; nor shall the Freight Forwarder be under any obligation to ensure that the shipped Goods correspond with the samples.',
          ],
        },
      ],
    },
    {
      heading: 'Liability',
      articles: [
        {
          number: 11,
          title: 'Liability',
          paragraphs: [
            'All Services shall be at the Client’s expense and risk.',
            'Without prejudice to the provisions in Article 17, the Freight Forwarder shall not be liable for any damage whatsoever, unless the Client can prove that the damage has been caused by fault of negligence on the part of the Freight Forwarder or the latter’s employees.',
            'The Freight Forwarder’s liability shall in all cases be limited to 10,000 SDR per occurrence or series of occurrences with one and the same cause of damage. Taking into account the aforementioned limit, in the event of damage, loss of value or loss of the Goods in the Agreement, the liability shall be limited to 4 SDR per kilogram of damaged or devalued Goods or lost gross weight.',
            'The loss to be indemnified by the Freight Forwarder shall never exceed the invoice value of the Goods, to be proved by the Client, in default whereof the market value, to be proved by the Client, at the time when the damage occurred, shall apply.',
            'The Freight Forwarder shall never be liable for lost profit, consequential loss and immaterial damage, however that occurred.',
            'If during the execution of the Agreement damage occurs for which the Freight Forwarder is not liable, taking into account the provisions in Article 19 of these Conditions, the Freight Forwarder shall make efforts to recover the Client’s damage from the party that is liable for the damage. The Freight Forwarder shall be entitled to charge to the Client the costs incidental thereto. If so requested, the Freight Forwarder shall waive in the Client’s favour its claims against Third Parties whose services it engaged for the purpose of executing the Agreement.',
            'The Client shall be liable vis-a-vis the Freight Forwarder for any damage – including but not limited to material and immaterial damage, consequential damage, fines, interest, as well as penalties and confiscation, including damage on account of non-clearance or tardy clearance of customs documents and claims due to product liability and/or intellectual property rights – suffered directly or indirectly by the Freight Forwarder as a result of (amongst other things) the non-compliance by the Client of any obligation pursuant to the Agreement or pursuant to applicable national and/or international legislation, as a result of any incident that is within the control of the Client, as well as a result of the fault or negligence in general of the Client and/or its employees and/or Third Parties whose services the Client engages and/or Third Parties that work on behalf of the Client.',
            'The Client shall indemnify the Freight Forwarder at all times against third-party claims, including employees of both the Freight Forwarder and the Client, connected with or ensuing from the damage referred to in the previous paragraph.',
            'Even where all-in or fixed rates, as the case may be, have been agreed, the Freight Forwarder that is not a carrier but always a party that arranges transportation in accordance with title 2, section 3 of Book 8 of the Dutch Civil Code, shall be liable, whereby the liability is governed by these Conditions.',
            'If a claim is made against the Freight Forwarder by the Client outside of the Agreement in respect of the damage that occurs during the execution of the Services, then the Freight Forwarder’s liability shall be limited to the liability under the Agreement.',
            'If to defend its liability for conduct of a Third Party or employee the Freight Forwarder derives a defence from the Agreement vis-a-vis the Client, then if it is held liable by the Client under this defence, a Third Party or employee can invoke this defence as if the Third Party or employee were also party to the Agreement.',
            'In the event a Freight Forwarder is held liable outside of the Agreement with regard to damage to or loss of a Good or delay in delivery by someone who is not party to the Agreement or a transport agreement entered into by or on behalf of the Freight Forwarder, then the Freight Forwarder has no further liability than it would have under the Agreement.',
          ],
        },
        {
          number: 12,
          title: 'Force majeure',
          paragraphs: [
            'In the event of Force Majeure, the Agreement shall remain in force; the Freight Forwarder’s obligations shall, however, be suspended for the duration of the Force Majeure.',
            'All additional costs caused by Force Majeure, such as transport and storage charges, warehouse or yard rental, demurrage and standing fees, insurance, removal, etc., shall be borne by the Client and shall be paid to the Freight Forwarder at the latter’s first request.',
          ],
        },
        {
          number: 13,
          title: 'Refusal of carriers',
          paragraphs: [
            'If the carriers refuse to sign for quantity, weight, etc., the Freight Forwarder shall not be liable for the consequences thereof.',
          ],
        },
      ],
    },
    {
      heading: 'Imperative law',
      articles: [
        {
          number: 14,
          title: 'The Agreement to organise transportation of goods',
          paragraphs: [
            'These Conditions shall not affect articles 8:61 paragraph 1, 8:62 paragraphs 1 and 2 and 8:63 paragraphs 1,2 and 3 of the Dutch Civil Code.',
          ],
        },
      ],
    },
    {
      heading: 'Payment',
      articles: [
        {
          number: 15,
          title: 'Payment conditions',
          paragraphs: [
            'The Client shall pay to the Freight Forwarder the agreed remunerations and other costs, freights, duties, etc. ensuing from the Agreement upon commencement of the Services, unless agreed otherwise.',
            'The risk of exchange rate fluctuations shall be borne by the Client.',
            'The amounts referred to in paragraph 1 shall also be due if damage has occurred during the execution of the Agreement.',
            'If, in contravention of paragraph 1 of this article, the Freight Forwarder allows deferred payment, the Freight Forwarder shall be entitled to make a credit limit charge.',
            {
              text: 'In the event of termination or dissolution of the Agreement, all claims of the Freight Forwarder – including future claims – shall be due and payable forthwith and in full. All claims shall be due and payable forthwith and in full in any case, if:',
              items: [
                'the bankruptcy of the Client is announced, the Client applies for suspension of payment or otherwise loses the unrestricted disposition over a significant part of its assets;',
                'the Client offers a settlement to his creditors, is in default of fulfilling any financial obligation owed to the Freight Forwarder, ceases to trade or – where the Client is a legal entity or corporate body – if the legal entity or the corporate body is dissolved.',
              ],
            },
            'Upon first demand by the Freight Forwarder, the Client must provide security for the amount owed or that shall be owed by the Client to the Freight Forwarder. This obligation remains if the Client also has to provide or has provided security in relation to the amount owed.',
            'The Freight Forwarder shall not be obliged, from its own means, to provide security for the payment of freight, duties, levies, taxes and/or other costs should the same be demanded. All the consequences of non-compliance or of failure to comply forthwith with a demand from the Freight Forwarder to provide security shall be borne by the Client.',
            'If the Freight Forwarder has provided security from of its own means, it may demand that the Client immediately pays the amount for which security has been provided.',
            'Where possible, the Freight Forwarder shall consult in advance with the Client. If no timely prior consultation is possible, the Freight Forwarder will take the measures that seem to it to be in the best interests of the Client and shall inform the Client of that.',
            'The Client shall at all times be obliged to indemnify the Freight Forwarder for any amounts to be levied or additionally demanded by any authority in connection with the Agreement, as well as any related fines imposed upon the Freight Forwarder.',
            'The Client shall also reimburse the said amounts to the Freight Forwarder if a Third Party brought in by the Freight Forwarder demands payment for the said amounts within the framework of the Agreement.',
            'The Client shall at all times indemnify the Freight Forwarder for any amounts, as well as for all additional costs that may be claimed or additionally claimed from the Freight Forwarder in connection with the order, as a result of incorrectly levied freight and costs.',
            'It shall not be permissible for claims receivable to be set off against payment of remunerations arising from the Agreement on any other account in respect of the Services owed by the Client or of other costs chargeable against the Goods with claims of the Client or suspension of the aforementioned claims by the Client.',
          ],
        },
        {
          number: 16,
          title: 'Allocation of payments and judicial and extrajudicial costs',
          paragraphs: [
            'Cash payments shall be deemed in the first place to have been made on account of non-preferential debts.',
            'The Freight Forwarder shall be entitled to charge to the Client extrajudicial and judicial costs for collection of the claim. The extrajudicial collection costs are owed as from the time at which the Client is in default and these amount to 10% of the claim, with a minimum of € 100.00.',
          ],
        },
        {
          number: 17,
          title: 'Sureties',
          paragraphs: [
            'The Freight Forwarder has the right to refuse the delivery of Goods, documents and monies, that the Freight Forwarder has or will obtain, for whatever reason and with whatever destination, in respect of another party.',
            'The Freight Forwarder has a right of retention in respect of all Goods, documents and monies that the Freight Forwarder holds or will hold for whatever reason and with whatever destination, for all claims the Freight Forwarder has or might have in future on the Client and/or the owner of the Goods, including in respect of all claims which do not relate to those Goods.',
            'The Freight Forwarder has a right of lien in respect of all Goods, documents and monies that the Freight Forwarder holds or will hold for whatever reason and with whatever destination, for all claims the Freight Forwarder has or might have in future on the Client and/or the owner of the Goods.',
            'The Freight Forwarder shall regard anyone who, on behalf of the Client, entrusts Goods to the Freight Forwarder for performing Services, as the Client’s agent for creating a lien on those Goods.',
            'If when settling the invoice a dispute arises over the amount due or if there is need for a calculation to be made for the determination of what is due that cannot be made quickly, then at the discretion of the Freight Forwarder, the Client or the party that demands delivery at the request of the Freight Forwarder is obliged to pay forthwith the part which the parties agree is due and to furnish security for the part in dispute or for the part for which the amount has not yet been established.',
            'The Freight Forwarder can also exercise the rights outlined in this article (right of lien, right of retention and right to refuse delivery) for what is still owed to it by the Client in relation to previous orders and for any amounts payable by way of delivery C.O.D. in respect of the Goods.',
            'The sale of any security shall take place at the account of the Client in the manner prescribed by law or – if there is consensus thereon – privately.',
            'At the Freight Forwarder’s first request, the Client shall furnish security for costs paid or to be paid by the Freight Forwarder to Third Parties or government authorities and other costs that the Freight Forwarder incurs or anticipates incurring, on behalf of the Client, including freight, port costs, duties, taxes, levies and premiums.',
            'In the absence of documents, the Freight Forwarder is not obliged to give indemnities or furnish securities. If the Freight Forwarder has given indemnification or furnished security, the Client is obliged to indemnify the Freight Forwarder from all consequences thereof.',
          ],
        },
      ],
    },
    {
      heading: 'Final provisions',
      articles: [
        {
          number: 18,
          title: 'Termination of the Agreement',
          paragraphs: [
            {
              text: 'The Freight Forwarder can terminate the Agreement with immediate effect in the event the Client:',
              items: [
                'discontinues its profession or business largely or in full;',
                'loses the power to dispose of its assets or a substantial part thereof;',
                'loses its legal personality, is dissolved or effectively liquidated;',
                'is declared bankrupt',
                'offers an agreement excluded from the bankruptcy proceedings;',
                'applies for moratorium on payment;',
                'loses the power to dispose of its goods or a substantial part thereof as a result of seizure.',
              ],
            },
            {
              text: 'If the Freight Forwarder consistently imputably fails to fulfil one or more of its obligations under the Agreement, without prejudice to its right to compensation for any damage that may have been suffered in accordance with article 11, the Client can dissolve the Agreement with immediate effect in full or in part after:',
              items: [
                'it has notified the Freight Forwarder by registered letter with reasons how the Freight Forwarder has failed to comply, stipulating a period of time of at least thirty days for fulfilment of the obligations, and;',
                'on expiry of that deadline, the Freight Forwarder has not yet fulfilled the obligations.',
              ],
            },
            'If the Client consistently imputably fails to fulfil one or more of its obligations under the Agreement, without prejudice to its right to compensation for any damage that may have been suffered, the Freight Forwarder can dissolve the Agreement with immediate effect in full or in part after, by registered letter, it has stipulated a deadline to the Client of at least fourteen days for fulfilment of the obligations and upon expiry of that deadline, the Client has not yet fulfilled its obligations. If, by stipulating such a period, the Freight Forwarder’s interests in the undisturbed conduct of its business would be impaired disproportionately, the Freight Forwarder may dissolve the Agreement without observing a time limit.',
            'Neither of the Parties may dissolve the Agreement if, considering its special nature or limited significant, the failure does not justify dissolution with all implications thereof.',
          ],
        },
        {
          number: 19,
          title: 'Proceedings against Third Parties',
          paragraphs: [
            'Legal and arbitration proceedings against Third Parties shall not be conducted by the Freight Forwarder unless it agrees to do so at the Client’s request and at the latter’s expense and risk.',
          ],
        },
        {
          number: 20,
          title: 'Prescription and limitation',
          paragraphs: [
            'Notwithstanding the provisions in paragraph 5 of this article, every claim is subject to prescription by the expiry of a period of nine months.',
            'Every claim vis-a-vis the Freight Forwarder shall be time-barred by the mere expiry of a period of 18 months.',
            'The periods of time stated in paragraphs 1 and 2 commence on the day following the day on which the claim has become due and payable, or the day following the day on which the prejudiced party had the knowledge of the loss. Notwithstanding the foregoing provisions, the aforementioned periods of time for claims with regard to damage, value depreciation or loss of the Goods, commence on the day following the day on which the Goods are delivered by the Freight Forwarder or should have been delivered.',
            {
              text: 'In the event that the Freight Forwarder is held liable by Third Parties, including any public authority, for damages, the periods of time stated in paragraphs 1 and 2 commence as from the first of the following days:',
              items: [
                'the day following the day on which the Third Parties have brought action against the Freight Forwarder;',
                'the day following the day on which the Freight Forwarder has settled the claim brought against it.',
              ],
            },
            'If the Freight Forwarder or the Third Party whose services it has engaged objects and/or appeals, the periods of time stated in paragraphs 1 and 2 commence on the day following the day on which a final ruling has been given on the objections and/or appeal.',
            'Unless the situation referred to in paragraph 4 of this article occurs, if following the term of prescription a claim is brought against one of the parties for that payable by that party to a Third Party, a new term of prescription of three months commences.',
          ],
        },
        {
          number: 21,
          title: 'Choice of law',
          paragraphs: [
            'All Agreements to which these Conditions apply are governed by Dutch law.',
            // As supplied: this sentence is incomplete in the source text.
            'The place of payment',
            'All disputes resulting from or relating to the contract will be subject to the decision of the competent court in Amsterdam or Rotterdam.',
          ],
        },
      ],
    },
    {
      heading: 'Concluding paragraph',
      articles: [
        {
          number: 22,
          title: 'Concluding paragraph',
          paragraphs: [
            'In case this English translation of our “Expeditievoorwaarden” (in Dutch) differs from the Dutch text, the latter will prevail.',
          ],
        },
      ],
    },
  ],
};

export const WAREHOUSING = {
  id: 'warehousing',
  title: 'Warehousing Conditions Pay Less Shop More',
  // false would show a "the rest will be added soon" line under the text.
  complete: true,
  parts: [
    {
      heading: 'General provisions',
      sections: [
        {
          number: 1,
          title: 'Application of these standard conditions',
          numbered: false,
          paragraphs: [
            '1.1 These conditions shall apply to all legal relations between warehousing companies and their principals, even after the termination of the agreement, as far as the provisions of Chapter I hereof are concerned, and to the legal relation between warehousing companies and holders of receipts, as far as the provisions of Chapter II hereof are concerned, if the receipt states that these conditions – referred to by the name “Dutch Warehousing Conditions” – are applicable.',
            '1.2 To the agreement between the principal and the warehousing companies shall explicitly not apply any standard conditions to which the principal might refer in any manner or the principal might declare as applicable.',
            '1.3 The principal nor the receipt holder may appeal to regulations or provisions if they are contrary to these conditions.',
            '1.4 With regard to the activities and services as those of forwarding agents, shipping-agents/shipbrokers, stevedores, carriers, insurance brokers, control companies, etc. performed by the warehousing company, the conditions customary in the relevant branch of trade, or the conditions whose application has been agreed, shall also apply.',
          ],
        },
        {
          number: 2,
          title: 'Definitions',
          numbered: false,
          paragraphs: [
            {
              text: 'In these conditions it is understood by:',
              items: [
                'warehousing company: the party who – apart from the possibility of wider terms of reference – accepts orders for warehousing or custody or delivery of goods (Chapter I) or the party who has goods in custody against which a receipt issued by him is in circulation (Chapter II);',
                'principal: the party who instructs the warehousing company to store or deliver goods, or the person for whom the warehousing company stores goods for which no receipt is in circulation;',
                'receipt: a numbered and legally signed or stamped document entitled “receipt” or a synonym, stating that the holder has the right to receive the goods mentioned therein;',
                'receipt holder: the person who identifies himself to the warehousing company as holder of a receipt by producing the receipt or in any other manner acceptable to the warehousing company;',
                'last receipt holder known to the warehousing company: the person to whom a receipt has been issued and subsequently the receipt holder whose written request to the warehousing company to be considered as such bears the most recent date, provided however that the warehousing company shall have the right but not be obliged to regard someone else as such if they have reason to assume he is the last receipt holder.',
              ],
            },
          ],
        },
        {
          number: 3,
          title: 'Applicable Law',
          numbered: false,
          paragraphs: [
            '3.1 All contracts to which the present conditions apply shall be governed by Dutch law.',
            '3.2 The place for settlement and adjustment of damage shall be that where the forwarder’s business is situated.',
          ],
        },
        {
          number: 4,
          title: 'Disputes',
          numbered: false,
          paragraphs: [
            '4.1 All disputes resulting from or relating to the contract will be subject to the decision of the competent court in Amsterdam or Rotterdam.',
          ],
        },
        {
          number: 5,
          title: 'Filed conditions',
          numbered: false,
          paragraphs: [
            '5.1 These conditions have been filed with the Registrar of the District Court of Rotterdam. They shall be sent on request.',
            '5.2 In case of difference between the Dutch text and the text in any other language of these Dutch Warehousing Conditions, the Dutch text shall be decisive.',
          ],
        },
      ],
    },
    {
      heading: 'Chapter I – Provisions relating to presenting, warehousing, custody and delivery',
      sections: [
        {
          number: 6,
          title: 'Written records',
          numbered: false,
          paragraphs: [
            '6.1 All agreements, tenders, instructions regarding warehousing, custody, handling and delivery of goods, shall be recorded in writing.',
            '6.2 Oral or telephone communications or arrangements shall only be binding on the warehousing company if immediately confirmed in writing, unless otherwise agreed.',
          ],
        },
        {
          number: 7,
          title: 'Description of goods and supply of information',
          numbered: false,
          paragraphs: [
            '7.1 Tender of goods and instructions on warehousing, custody and handling shall be effected or supplied giving an exact and full written description of the goods, such as inter alia their value, the number of packages, the gross weight and furthermore all particulars of such nature that the agreement would not have been made or not on the same terms and conditions if the warehousing company had been acquainted with the true state of affairs.',
            '7.2 If goods are subject to customs and excise provisions or to tax regulations or other government rules, the principal shall promptly supply all information and documents required in this connection, in order to enable the warehousing company to comply with such provisions or regulations.',
          ],
        },
        {
          number: 8,
          title: 'Rates/payments/taxes',
          numbered: false,
          paragraphs: [
            '8.1 Current rates and payments for work and all oral or written agreements between the warehousing company and the principal regarding rates and payments for work shall be based on the cost of labour prevailing at the time the instructions were given or the agreement was made.',
            'In case of an increase in the cost of labour, the current or the agreed rates and payments shall be adjusted accordingly with immediate effect. The warehousing company shall also have the right to adjust the rates in case the authorities introduce or increase charges imposed on the services rendered by the warehousing company.',
            '8.2 Current and agreed rates for warehousing shall be based on the customary method of stacking the relevant goods, unless expressly agreed otherwise. If at the principal’s request or in view of the condition of the goods the customary method of stacking is departed from, an increase in the rates shall be applied proportional to the additional floor space occupied compared to normal stacking.',
          ],
        },
        {
          number: 9,
          title: 'Duties, costs and taxes',
          numbered: false,
          paragraphs: [
            '9.1 All freight, reimbursements, taxes, duties, contributions, levies, fines and/or other charges or costs by whatever name, falling on or relating to the goods and payable on arrival or charged forward, shall be for account of the principal and shall be paid or reimbursed by the principal whether or not in advance, on the warehousing company’s first demand, irrespective of whether such goods are not yet on the premises or have meanwhile been removed.',
            '9.2 If the warehousing company thinks it necessary to conduct lawsuits or to take other legal steps with regard to taxes, duties, contributions, levies, fines and or other charges or costs by whatever name imposed by the authorities, or if the principal requests the warehousing company to conduct such lawsuits or take such legal steps and the warehousing company complies with such request, the resulting work and costs including the cost of legal and/or fiscal and/or other advice or assistance deemed necessary by the warehousing company, shall be for the principal’s account and risk.',
            'Before conducting lawsuits or taking legal measures in terms of this section, the warehousing company shall try to consult on the matter with, or to obtain instructions from the principal or the party directly concerned.',
            '9.3 If the warehousing company acts or has acted as fiscal agent, all taxes, duties, contributions and other levies as well as fines, interest, costs, by whatever name, or indemnifications due and payable by the warehousing company, shall be for account of the principal, without prejudice to the provisions of subsection 1 of this section. The principal shall pay such amounts on the warehousing company’s first demand.',
          ],
        },
        {
          number: 10,
          title: 'The principal’s liability',
          numbered: false,
          paragraphs: [
            '10.1 The principal shall be liable towards the warehousing company and/or third parties for any loss or damage resulting from incorrect and/or misleading and/or incomplete descriptions or indications or information, as well as for loss or damage resulting from defects of the goods and/or the packing not reported beforehand, even if such loss or damage was caused through no fault of his. If no weight is stated or stated incorrectly, the principal shall be liable for any resulting loss or damage.',
            '10.2 The principal shall be liable for any damage resulting from not, not timely or not properly meeting any of his obligations under these conditions, or under a separate agreement between the warehousing company and the principal, if no provisions are already included herein.',
            '10.3 Notwithstanding the above provisions the principal shall indemnify the warehousing company against claims from third parties or compensate the warehousing company for damages paid or due by third parties or paid or due to third parties, including the employees of both the warehousing company and the principal, relating to the nature or condition of the goods stored.',
          ],
        },
        {
          number: 11,
          title: 'Refusing an order',
          numbered: false,
          paragraphs: [
            'The warehousing company shall have the right to refuse an order for warehousing and/or custody without giving reasons therefor. If the warehousing company has accepted the order, the agreement may only be broken by mutual consent of the two parties.',
          ],
        },
        {
          number: 12,
          title: 'Inspection of goods',
          numbered: false,
          paragraphs: [
            '12.1 The warehousing company shall not be obliged to weigh or measure the goods stored without instructions thereto.',
            '12.2 It is in the warehousing company’s discretion to weigh and measure the goods in order to verify the specifications received. If in such case the warehousing company ascertains that weights or measures differ from the specification, the cost of weighing and/or measuring shall be for the principal’s account. However, the warehousing company shall only be responsible for ascertaining weights and/or measures, if the goods have been weighed and/or measured by the warehousing company on the principal’s instructions and without prejudice to the provisions of section 19 on the warehousing company’s liability.',
            '12.3 Packages may only be opened for inspecting their contents at the principal’s request, but the warehousing company shall at all times have the right, but not be obliged, thereto if they suspect that the contents have been described incorrectly.',
            '12.4 If on inspection it appears that the contents differ from the specification, the cost of inspection shall be for the principal’s account. However, the warehousing company shall never be responsible for the description and/or designation of goods taken into custody.',
          ],
        },
        {
          number: 13,
          title: 'Presenting/delivery and receipt',
          numbered: false,
          paragraphs: [
            '13.1 Presenting to and receipt by the warehousing company shall be made by the principal’s presenting the goods and their acceptance by the warehousing company at the place of warehousing.',
            '13.2 Delivery to and receipt by the principal shall be made by the warehousing company’s delivery of the goods and their acceptance by the principal at the place of warehousing.',
          ],
        },
        {
          number: 14,
          title: 'Condition of the goods on arrival',
          numbered: false,
          paragraphs: [
            '14.1 Unless otherwise stated, goods shall be delivered to the warehousing company in good condition and if packed, properly packed.',
            '14.2 If the goods sent to the warehousing company arrive in apparent damaged or defective condition, the warehousing company shall have the right, but not be obliged, to protect the principal’s interests against the carrier or others for the principal’s account and risk, and to provide evidence of such condition, however, without the principal being able to derive any right against the warehousing company from the manner in which the warehousing company have performed such work. The warehousing company shall notify the principal instantly, without the latter having any right of claim against the warehousing company because of failure to notify.',
            '14.3 Goods received for warehousing, which a conscientious warehousing company, had it known they might be dangerous after receipt, would not have accepted for warehousing in view of this, may at any moment be removed or destroyed or rendered harmless in another manner by them.',
            '14.4 With regard to the warehousing of goods of which the warehousing company knew their danger, the same shall apply, but only when such goods present an immediately imminent danger.',
            '14.5 The warehousing company shall not owe any indemnification in such matter and the principal shall be liable for all costs and damages to the warehousing company resulting from the presentation for warehousing, from the warehousing itself or from the measures taken, unless such costs and damages or the need for taking such measures are exclusively due to faults on the part of the warehousing company.',
            '14.6 As a result of the measures taken the agreement on the goods stated therein shall cease, but if such goods are delivered as yet, only after their delivery.',
          ],
        },
        {
          number: 15,
          title: 'Commencement of execution of order for warehousing',
          numbered: false,
          paragraphs: [
            'Unless agreed otherwise or prevented by special circumstances, the warehousing company shall as soon as possible after accepting the order and on receipt of the required documents, particulars and handling instructions, commence the execution of accepted orders for warehousing or delivery of goods.',
          ],
        },
        {
          number: 16,
          title: 'Late or irregular delivery or removal',
          numbered: false,
          paragraphs: [
            'If the principal has advised the warehousing company that goods are to be presented for warehousing in a particular quantity and/or at a specified time, or that goods to be removed are to be collected in a particular quantity and/or at a specified time, and if in such case the principal fails to present or collect in time and regularly, the principal shall be obliged to pay the costs resulting for the warehousing company, because workers and equipment ordered and/or assigned by the warehousing company for executing the relevant order are not or not fully employed.',
          ],
        },
        {
          number: 17,
          title: 'Working hours',
          numbered: false,
          paragraphs: [
            'Presenting goods to and removal of goods from the place of warehousing shall be made during the official working hours of the warehousing company’s staff. If the principal desires work to be done outside the official working hours, it is in the warehousing company’s discretion to comply or not. Extra costs incurred for working outside the official working hours, shall be borne by the principal.',
          ],
        },
        {
          number: 18,
          title: 'Place of warehousing, transfer of goods',
          numbered: false,
          paragraphs: [
            '18.1 Unless otherwise agreed, it shall be in the warehousing company’s discretion where the goods are to be stored.',
            '18.2 The warehousing company shall at all times have the right to transfer the goods to another place of warehousing.',
            {
              text: '18.3 The cost of such transfer shall be for the warehousing company’s account, unless such transfer is to be made:',
              items: [
                'in the interest of the principal or the goods, or',
                'due to circumstances for which the warehousing company is not responsible, or',
                'due to circumstances that cannot reasonably be for the warehousing company’s account and risk, or',
                'due to government rules and regulations.',
              ],
            },
            'The transport related to the transfer for the warehousing company’s account, shall take place on the customary transport conditions.',
            'The transport related to the transfer for the principal’s account, shall be undertaken by the warehousing company as forwarding agent and shall be made at the principal’s risk.',
            '18.4 If the goods are transferred to another place of warehousing, the warehousing company shall notify the principal, without the latter being able to make any claim against the warehousing company for failing to notify.',
          ],
        },
        {
          number: 19,
          title: 'Damage/loss of goods',
          numbered: false,
          paragraphs: [
            '19.1 Under the present warehousing conditions the principal renounces any right of recovery against third parties in case of damage and/or loss; he shall exclusively be able to hold the warehousing company liable, even if the warehousing company has employed the services of third parties in the course of their business, all of which with the following limitation.',
            '19.2 All activities and work shall be performed for the principal’s account and risk, unless provided otherwise herein.',
            '19.3 The warehousing company shall not be liable for any damage, unless the principal proves that the damage was caused by faults or negligence of the warehousing company or it’s staff.',
            '19.4 In case of damage and/or loss because of theft by means of burglary, the warehousing company shall be considered to have applied adequate care, if it has provided proper closure of the place of warehousing.',
            '19.5 In the case of goods stored on open grounds or which can only be stored on open grounds or of which it is customary for the warehousing company to store them on open grounds, any liability of the warehousing company for damage that may be related to such warehousing, shall be excluded.',
            '19.6 The warehousing company’s liability in all cases shall be limited to 2 SDRs per kilogram damaged or lost gross weight with a maximum of 100,000 SDRs per event or series of events with the same cause of damage.',
            '19.7 The damage to be compensated by the warehousing company shall never exceed the invoice value of the goods, to be proved by the principal, in the absence of which their market value, to be proved by the principal, at the time the damage was done, shall apply. The warehousing company shall only be liable for damage to the goods themselves and for damage in terms of subsection 19.9 and shall never be liable for lost profits, consequential damage and immaterial damage.',
            '19.8 In case of damage to an independent part of the goods, or in case of damage to one or more parts of several goods belonging together, any depreciation of the remaining parts or the undamaged goods shall not be considered.',
            '19.9 The warehousing company’s liability for damage resulting from complying with (customs) formalities shall be limited to 7500 SDRs per event or series of events with one and the same cause of damage.',
          ],
        },
        {
          number: 20,
          title: 'Admittance to the premises',
          numbered: false,
          paragraphs: [
            '20.1 The warehousing company shall be obliged to admit the principal and the persons designated by him, for the principal’s account and risk, to the place where his goods are stored, subject to the compliance with the customs and other formalities prescribed by the authorities.',
            {
              text: '20.2 To the persons to whom the warehousing company grants admittance the following conditions shall apply:',
              items: [
                'all persons visiting the place of warehousing including the crew of vessels and vehicles arriving at the place of warehousing, shall observe the warehousing company’s regulations;',
                'admittance shall be granted only during regular working hours and under escort;',
                'the cost of escorting visitors shall be paid to the warehousing company by the principal;',
                'the principal shall be liable for any damage caused directly or indirectly by the visitors.',
              ],
            },
            '20.3 The principal shall indemnify the warehousing company against third party claims, including both the warehousing company’s and the principal’s employees, relating to damage resulting from the preceding subsections.',
          ],
        },
        {
          number: 21,
          title: 'Performance of activities',
          numbered: false,
          paragraphs: [
            '21.1 The performance of the work required by the principal, such as sampling, handling, servicing, repacking, restacking, lotting, weighing, etc., as well as delivery, shall be entrusted to the warehousing company having the goods in custody, at the appropriate fees and on the appropriate conditions.',
            '21.2 Any work the warehousing company does not wish to undertake may, with the warehousing company’s consent, be executed by or on behalf of the principal, subject to the conditions made by the warehousing company, under the supervision of the warehousing company and against payment of the costs involved, however without any liability of the warehousing company.',
          ],
        },
        {
          number: 22,
          title: 'Special method of handling goods',
          numbered: false,
          paragraphs: [
            '22.1 The warehousing company shall not be obliged to take any measures in respect of the goods received into custody or their packing, than such measures as are considered normal for the custody of the goods concerned.',
            '22.2 The warehousing company shall only be obliged to take special measures if they have been agreed.',
            '22.3 However, the warehousing company shall have the right to take immediate action at the principal’s cost and risk, including the clearance or removal or destruction or rendering harmless in any other manner, if it is feared that failure to take such action may cause loss and/or damage to the goods themselves or to other goods, or to the warehousing or to equipment, or injury to persons, or when measures are required or indicated for some other reason, such in the warehousing company’s discretion. The warehousing company shall immediately inform the principal of the measures taken, without the latter having any right of claim against the warehousing company because of failure to meet such obligation.',
            '22.4 Without prejudice to the provisions of the preceding subsection, the principal shall indemnify the warehousing company against any third party claims for damage caused by the principal’s goods to goods pertaining to third parties.',
          ],
        },
        {
          number: 23,
          title: 'Insurance of goods',
          numbered: false,
          paragraphs: [
            '23.1 Unless expressly agreed with the principal in writing the warehousing company shall not be obliged to effect any insurance for goods.',
            'If it has been agreed between the warehousing company and the principal that the warehousing company is to effect insurance of the goods for the principal’s account, the warehousing company shall have the right in their discretion to effect the agreed insurance in the principal’s name, or to include such insurance in a warehouse policy.',
            'The value to be insured shall be the amount stated by the principal. The warehousing company shall in all cases of insurance exclusively be regarded as intermediary without any liability, nor for the terms and conditions agreed with the insurer(s) or for their reliability or their solvency.',
            '23.2 In all cases where the goods have been insured through the intermediary of the warehousing company, the warehousing company shall have the right to collect the amounts claimed for and on behalf of the parties interested in the goods and to recover therefrom all their claims, for whatever reason, on the principal.',
            'The balance shall be paid to the principal.',
            '23.3 If in case of damage to or loss of goods by fire or by any other cause, the assistance of the warehousing company for assessing the damage or loss is desirable or necessary, such assistance shall be rendered by the warehousing company against payment of the costs involved and of a fee for their efforts. The warehousing company may make such assistance contingent on the cash payment of, or the provision of security for all amounts owing to the warehousing company by the principal for whatever reason and the costs and fee referred to in this subsection.',
            '23.4 In case of partial delivery of the goods by the warehousing company, the principal shall inform the warehousing company for what amount he wishes to have the remaining goods insured.',
            'In the absence of such information the warehousing company shall have the right to reduce the insured amount in their own discretion in the same proportion as the decrease in the number, weight, measure or contents of the goods.',
          ],
        },
        {
          number: 24,
          title: 'Charging warehouse rent in case of destruction of goods',
          numbered: false,
          paragraphs: [
            'In case the goods stored with the warehousing company are destroyed by fire or otherwise, the day of destruction shall count as the date of delivery and the warehouse rent plus – if the goods were insured through the warehousing company – insurance premium and costs calculated in full monthly periods, shall be due and payable up to and including such date.',
          ],
        },
        {
          number: 25,
          title: 'Removal of goods',
          numbered: false,
          paragraphs: [
            '25.1 The principal may, upon payment of all amounts due to the warehousing company (in the widest sense) and subject to the provisions hereof, at any time remove the goods placed in custody.',
            '25.2 The warehouse rent – and if the goods were insured through the warehousing company, the insurance premiums and costs – shall always be charged in full months, part of a month counting as a full month.',
            '25.3 If a fixed period of warehousing has been agreed, the warehousing company cannot require the principal to remove the goods prior to the expiration of the agreed period of time.',
            '25.4 If no period of warehousing has been agreed or if the agreed period of warehousing has expired, the warehousing company may require the removal at one month’s notice, however not within three months of the commencement of warehousing.',
            '25.5 In case of force majeure the agreement shall remain in force; however, the warehousing company’s obligations shall be suspended for the duration of the force majeure. All extra costs caused by force majeure shall be for the principal’s account.',
            'Force majeure shall be all circumstances the warehousing company has reasonably been unable to avoid and whose consequences the warehousing company has reasonably been unable to prevent.',
          ],
        },
        {
          number: 26,
          title: 'Premature removal of goods for urgent reasons',
          numbered: false,
          paragraphs: [
            '26.1 However, the warehousing company shall at all times have the right to require the removal of the goods received for warehousing prior to the expiration of the warehouse period without observing any period of notice, if there is an urgent reason therefor.',
            '26.2 Urgent reason shall be understood to be a circumstance of such nature that according to rules of reasonableness and fairness the principal cannot expect the warehousing to be maintained.',
            '26.3 Such reason shall the deemed to exist inter alia if the principal fails to comply with one or more other provisions hereof, or if it appears that owing to the presence of the goods the hazard of loss and/or damage to other goods or the warehouse place or to equipment, or injury to persons is to be feared, and furthermore if the goods are perishable or liable to inherent changes which in the warehousing company’s opinion justify the assumption of deterioration and the principal has neglected to give instructions for preventing or controlling it.',
            '26.4 The principal shall remain under obligation to pay the warehouse rent up to the day of removal of the goods.',
          ],
        },
        {
          number: 27,
          title: 'Payment',
          numbered: false,
          paragraphs: [
            '27.1 All amounts owing to the warehousing company by the principal for whatever reason, such as: warehouse rent, insurance premiums and costs, rent, disbursements, fees for warehousing and delivery, outlays and charges for work done or to be done, cost of cleaning work and such like during or after a fire or otherwise, extraordinary expenses, extra wages, taxes, duties, levies, fines, interest etc., shall be immediately due and payable.',
            'If the warehousing company applies a term of payment, the said amounts shall be immediately due and payable on expiry of the term of payment.',
            '27.2 Without prejudice to the provisions of the preceding subsection the principal shall always pay the warehouse rent due promptly within the term agreed between the parties, but at least once in 12 months.',
            '27.3 If the principal does not immediately pay the amounts due to the warehousing company, the warehousing company shall have the right to charge the legal interest.',
            '27.4 Payments on account shall be regarded to have been made in the first place in reduction of ordinary debts, regardless of whether other instructions were given on payment.',
            '27.5 If in case of overdue payment the debt is collected by judicial or other action, the amount of the debt shall be increased by 10% administrative costs, while the judicial and extrajudicial costs shall be for the principal’s account, up to the amount paid or due by the warehousing company.',
          ],
        },
        {
          number: 28,
          title: 'Lien and right of retention',
          numbered: false,
          paragraphs: [
            '28.1 The warehousing company shall have a lien and a right of retention towards anyone requesting delivery thereof, on all goods, documents and monies the warehousing company holds or will hold for whatever reason and for whatever purpose, for all claims it has or may have in future on the principal and/or owner.',
            '28.2 The warehousing company may also exercise the rights awarded to it in subsection 28.1 for all amounts the principal still owes the warehousing company in connection with earlier orders.',
            '28.3 The warehousing company shall regard anyone who, on behalf of the principal entrusts goods to him for performing work, as the principal’s agent for creating a lien and a right of retention on such goods.',
            '28.4 In case of non-payment of the claim, the sale of the security shall take place in the manner prescribed by law, or – if there is consensus thereon – privately.',
          ],
        },
        {
          number: 29,
          title: 'Public sale',
          numbered: false,
          paragraphs: [
            '29.1 Without prejudice to the provisions of section 28 hereof, the warehousing company shall have the right to sell the goods entrusted to the warehousing company, or to have them sold, without observing any formality, in the place and in the manner and on the conditions the warehousing company may see fit, publicly or in any other manner the law may permit, at the expense of the principal and to recover from the proceeds all amounts the principal owes the warehousing company, in case the principal fails to remove the goods entrusted to the warehousing company on expiry of the agreement or at the agreed or specified time or at any other point of time in case of one of the urgent reasons mentioned in section 26 hereof.',
            '29.2 If it is probable that in case of sale the cost will be higher than the benefits or if no buyer is found despite a reasonable attempt thereto, the warehousing company shall have the right to remove the goods, to have them removed or to destroy them. The principal shall then remain liable for the amounts due, increased by the cost of removal or destruction.',
            '29.3 In case of sale the warehousing company shall hold the balance of the proceeds after deducting all costs and all the principal’s debts, at the principal’s disposal for five years, after which period the balance, if not claimed, shall accrue to the warehousing company.',
          ],
        },
        {
          number: 30,
          title: 'Prescription and extinction',
          numbered: false,
          paragraphs: [
            '30.1 Every claim shall become prescribed by the simple lapse of 12 months.',
            '30.2 All claims against the warehousing company shall become extinct by the simple lapse of 2 years.',
            {
              text: '30.3 In case of total loss, damage or reduction, the periods mentioned in subsections 30.1 and 30.2 shall commence on the first of the following days:',
              items: [
                'the day the warehousing company delivered or should have delivered the goods;',
                'the day the warehousing company informed the principal of such event.',
              ],
            },
            {
              text: '30.4 In case the warehousing company is held liable by third parties, including any government, the period mentioned in subsection 30.1 shall commence on the first of the following days:',
              items: [
                'the day the warehousing is held liable by the third party, or',
                'the day the warehousing company paid the claim against it.',
              ],
            },
            '30.5 Notwithstanding the provisions of subsections 30.3 and 30.4, the periods mentioned in subsections 30.1 and 30.2 for all other claims shall commence on the day they become due and payable.',
          ],
        },
        {
          number: 31,
          title: 'Complaints',
          numbered: false,
          paragraphs: [
            '31.1 If the goods are made available by the warehousing company without the principal or someone else for him having established their condition in the presence of the warehousing company or without having informed the warehousing company of reserves, in case of visible loss or damage not later than the moment the goods were made available, or in case of invisible loss or damage within five working days of the availability, indicating the general nature of the loss or damage, he shall be considered to have received the goods in good condition, unless the contrary is proved. In case of invisible loss or damage, the said reserves shall be made in writing.',
            '31.2 The day the goods are made available shall not be counted in the determination of the above periods.',
          ],
        },
        {
          number: 32,
          title: 'Transfer or transition of goods',
          numbered: false,
          paragraphs: [
            '32.1 Transfer or transition of ownership of stored goods, or the transfer or transition of the right to delivery thereof by a principal to a third party, shall be ineffectual against the warehousing company and without legal effect for the warehousing company, nor shall the warehousing company recognize such transfer or transition, unless all claims the warehousing company may have on the original and/or transferring principal for whatever reason, have been fully paid.',
            '32.2 The principal shall be obliged to inform the warehousing company instantly in writing of any transfer or transition of ownership of goods, or transfer or transition of the right to delivery of goods.',
            '32.3 Notwithstanding the provisions above the transfer or transition shall have no legal effect for the warehousing company, nor shall the warehousing company recognize them, unless the new owner(s) has(have) explicitly accepted in writing all provisions of the agreement between the warehousing company and the original and/or transferring principal as well as the present conditions.',
            '32.4 The warehousing company shall not be required to recognize the transfer or transition of ownership or the right to delivery of the goods and shall even have the right to revoke a recognition made, and they may refuse to deliver the goods, if in the warehousing company’s opinion there are flaws in the legal title regarding any transfer or transition of ownership of goods, or any transfer or transition of the right to delivery of goods, and if the new owner(s) claim(s) not to have accepted the present conditions or not to be committed thereto.',
            '32.5 The original and/or transferring principal shall remain liable to the warehousing company for all the warehousing company’s claims for or in connection with the warehousing and/or work performed in connection with such goods, even though they were performed after the transfer or transition of ownership, or after transfer or transition of the right to delivery.',
            'After transfer or transition of ownership, or the right to delivery of the goods, the new owner shall be regarded as the principal and shall, in addition to his legal predecessor, be severally liable for all the above claims, even though they may have arisen prior to the transfer or transition.',
          ],
        },
        {
          number: 33,
          title: 'Issue of receipts',
          numbered: false,
          paragraphs: [
            '33.1 The warehousing company may issue to the principal at his request a receipt, describing the goods given into custody to the warehousing company by the principal.',
            '33.2 The warehousing company shall have the right to refuse to issue a receipt, if the principal has not paid all claims the warehousing company may have on him for whatever reason.',
            'The warehousing company may furthermore refuse to issue a receipt if they believe there are reasons therefor.',
            '33.3 On the issue of a bearer receipt all the warehousing company’s obligations towards the principal shall cease and shall be replaced by the warehousing company’s obligations towards the receipt holder, which is regulated in more detail in Chapter II hereof. The principal shall, even after the issue of the receipt, remain liable towards to warehousing company for the effects of any discrepancy between the goods for which the receipt was issued and their description in the receipt.',
          ],
        },
      ],
    },
    {
      heading: 'Chapter II – Provisions regarding the receipt',
      sections: [
        {
          number: 34,
          title: 'Applicable provisions',
          numbered: false,
          paragraphs: [
            'The legal relations between warehousing companies and receipt holders shall also be subject to the provisions of Chapter I, unless the provisions of Chapter II require that a provision of Chapter I may not be applied.',
          ],
        },
        {
          number: 35,
          title: 'Right to delivery of goods',
          numbered: false,
          paragraphs: [
            '35.1 The receipt awards a right to delivery by the warehousing company of the goods they have received for warehousing and against which the receipt has been issued. For any discrepancy between the stored goods and their description in the receipt, the warehousing company shall be liable towards the receipt holder who was unaware of the existence of the discrepancy when acquiring the receipt, unless it concerns goods whose identification requires expert knowledge and/or a thorough examination or analysis.',
            '35.2 If the receipt contains the clause:',
            '“Contents, quality, number, weight or measure unknown”',
            'or a similar clause, the warehousing company shall not be bound by any statement in the receipt regarding the contents, the quality and the number, the weight or the measure of the goods.',
            '35.3 The right to delivery shall not exist as long as the warehousing company can lay any claim on the goods under the present conditions and until all customs and other formalities prescribed by the authorities and required for the delivery, have been fulfilled.',
          ],
        },
        {
          number: 36,
          title: 'Expiry of the receipt',
          numbered: false,
          paragraphs: [
            '36.1 The receipt shall be valid for three years, as from the date of issue, unless a shorter period of validity is stated in the receipt.',
            '36.2 Until its expiry the receipt may be replaced at the receipt holder’s request by a new receipt, against payment of the costs involved. The warehousing company shall have the right to refuse to replace the receipt and to require the removal of the goods on the expiry date.',
            '36.3 If on its expiry date the receipt has not been presented for replacement, or if after refusal to replace the receipt the goods have not been removed from the warehousing company on the expiry date, the holder of the expired receipt shall be considered to agree to the warehouse rent – and if the goods have been insured through the warehousing company, the insurance premium and costs – as shall be determined by the warehousing company as from such date.',
            '36.4 If on its expiry date the receipt has not been presented for replacement, or if after refusal to replace the receipt the goods have not been removed from the warehousing company on the expiry date against payment of the amount the warehousing company is entitled to under section 36 hereof, the warehousing company shall have the right to dispose of the goods to which the expired receipt refers, subject to the relevant provisions hereof.',
            '36.5 For a period of five years after the expiry date of the receipt the warehousing company shall be obliged to deliver the goods to which the expired receipt refers – or if the warehousing company has exercised it’s right to dispose of the goods, the net proceeds of the goods, without payment of interest – to the holder of the expired receipt, after deducting all amounts due to the warehousing company. On expiry of these five years the rights of the holder of the expired receipt shall cease and the warehousing company shall no longer be required to deliver the goods – or to account for their proceeds – neither to the holder of the expired receipt, nor to others.',
          ],
        },
        {
          number: 37,
          title: 'Delivery of goods after payment',
          numbered: false,
          paragraphs: [
            {
              text: '37.1 The warehousing company shall, prior to effecting full or partial delivery of the goods to which the receipt gives title, have the right to demand payment of:',
              lettered: true,
              items: [
                'warehouse rent for so many months as appears from the receipt to have elapsed, and have not been noted therein as having been paid prior to delivery, at the monthly rent stated in the receipt, parts of months to be counted as full months;',
                'insurance premiums and costs for so many months as appears from the receipt to have elapsed, and have not been noted therein as having been paid prior to delivery, at the monthly insurance premium stated in the receipt, parts of months to be counted as full months;',
                'the charges for delivering the goods at the current rate therefor;',
                'disbursements made by the warehousing company on behalf of the receipt holder requesting delivery, in connection with customs and/or other formalities prescribed by the authorities in respect of the goods described in the receipt;',
                {
                  text: 'all costs incurred by the warehousing company after the date of issue mentioned in the receipt:',
                  items: [
                    'e.1 for preserving the goods mentioned in the receipt;',
                    'e.2 for eliminating any dangers caused by the goods mentioned in the receipt to the place of warehouse and to other goods stored therein;',
                    'e.3 for measures taken in respect of the goods mentioned in the receipt as a result of circumstances for which the warehousing company cannot be held responsible.',
                  ],
                },
                'all other amounts due to the warehousing company apparent from the receipt.',
              ],
            },
            '37.2 Notwithstanding the provisions of the preceding subsection the receipt holder shall be obliged to pay the warehouse rent due – and if the goods have been insured through the warehousing company, the insurance premium and costs – at the end of each 12 months of warehousing or so much earlier as has been agreed and stated in the receipt plus the costs incurred by the warehousing company referred to in paragraphs d. and e. above, as soon as the warehousing company has informed him of such costs.',
            '37.3 If the receipt holder fails to meet his obligation to pay the rent after each 12 monthly period or so much earlier as has been agreed and stated in the receipt – and if the goods have been insured through the warehousing company, the insurance premium and costs – the amounts due to the warehousing company for this reason shall be increased, as from the day the 12 months warehousing elapsed, by a penalty of 1% of the amount due for each month in excess of the 12 month period.',
          ],
        },
        {
          number: 38,
          title: 'Indemnification',
          numbered: false,
          paragraphs: [
            'Contrary to the provisions of subsection 19.7 the indemnification to be paid by the warehousing company for loss of goods shall, in the absence of the invoice value of the goods, be limited to the market value of the goods on the day of issue of the receipt, to be proved by the principal.',
          ],
        },
        {
          number: 39,
          title: 'Access to and information about goods',
          numbered: false,
          paragraphs: [
            'Access to and information about goods for which receipts have been issued shall only be given on production of the relevant receipt.',
          ],
        },
        {
          number: 40,
          title: 'Activities in connection with the goods',
          numbered: false,
          paragraphs: [
            '40.1 The activities required by the receipt holder in relation to the goods described in the receipt, such as sampling, handling, servicing, repacking, restacking, lotting, weighing, etc., as well as delivery, shall be entrusted to the warehousing company having the goods in custody, against the appropriate fees and on the appropriate conditions.',
            '40.2 The activities required by the receipt holder shall only be carried out after surrender of the receipt.',
            '40.3 Activities the warehousing company does not wish to undertake may, with the warehousing company’s consent and after surrender of the receipt, be performed by or on behalf of the receipt holder, subject to conditions made by the warehousing company, under the supervision of the warehousing company and against payment of the costs involved, however without any responsibility of the warehousing company.',
            '40.4 Partial deliveries, sampling and handling of the goods causing a modification, decrease or change in the number of the goods shall be noted on the receipt in the proper place. If there is no space left on the receipt for further noting deliveries, modifications, decreases, etc., the receipt shall be replaced at the receipt holder’s expense.',
            '40.5 Payments due to the warehousing company for work performed in connection with the goods described in the receipt or for supervising such work, shall be paid immediately. The warehousing company shall have the right to refuse to return the receipt until such payments have been made.',
          ],
        },
        {
          number: 41,
          title: 'Notification of special method of handling',
          numbered: false,
          paragraphs: [
            'If the warehousing company decides to take a measure in terms of section 22, the warehousing company shall immediately notify the receipt holder last known to it, without the receipt holder having any right of claim against the warehousing company for omitting such notification.',
          ],
        },
        {
          number: 42,
          title: 'The warehousing company’s obligation to insure',
          numbered: false,
          paragraphs: [
            '42.1 If the receipt shows that the goods therein are insured, the warehousing company shall thereby have undertaken the obligation to effect insurance for the receipt holder’s account in accordance with the provisions of section 23.',
            '42.2 The insured value shall be the value stated in the receipt.',
            '42.3 If the receipt states that the insured value is the current market value, it shall be the warehousing company’s responsibility to keep the goods adequately insured.',
          ],
        },
        {
          number: 43,
          title: 'Changes in, effect and termination of insurance',
          numbered: false,
          paragraphs: [
            '43.1 Any changes in the insured value and termination of insurance shall only be possible when the receipt is surrendered for being endorsed accordingly.',
            '43.2 Only the insurance as stated in the receipt shall be effective.',
            '43.3 The insurance shall otherwise cease on delivery of the goods.',
            '43.4 On delivery of part of the goods the insured value of the goods to be delivered must be stated separately and endorsed on the receipt, if the receipt does not show the insured value per unit and if a proportionate decrease cannot be inferred from the receipt.',
          ],
        },
        {
          number: 44,
          title: 'Amounts of claims',
          numbered: false,
          paragraphs: [
            'The amounts of claims collected by the warehousing company shall be paid out by the warehousing company against surrender of the receipt, after deducting all amounts due to the warehousing company by the receipt holder.',
          ],
        },
        {
          number: 45,
          title: 'Notification of destruction of goods',
          numbered: false,
          paragraphs: [
            'In case of destruction of the goods described in the receipt by fire or otherwise, the warehousing company shall immediately notify the receipt holder last known to them, without the receipt holder having any right of claim against the warehousing company for omitting such notification.',
          ],
        },
        {
          number: 46,
          title: 'Mutilation of the receipt',
          numbered: false,
          paragraphs: [
            '46.1 Any erasures and mutilations shall render the receipt void; deletions shall not be valid unless initialled by the warehousing company.',
            '46.2 The holder of a mutilated receipt may request the issue of a duplicate, against surrender of the original receipt and on payment of the costs involved. For determining the nature and quantity of the goods to be shown in the duplicate receipt, the warehousing company’s relevant records shall exclusively be regarded as standard.',
          ],
        },
        {
          number: 47,
          title: 'Loss and destruction of receipts',
          numbered: false,
          paragraphs: [
            '47.1 If a receipt has been lost or destroyed, the rightful holder may apply to the warehousing company for nullification of such receipt and request delivery of the goods or the issue of a duplicate receipt; such application must, if possible, state the cause for the loss of the receipt and contain the grounds on which the applicant bases his title.',
            '47.2 If investigations made by the warehousing company afford no reasons to doubt the truth of the grounds of the application, the warehousing company shall publish the application made by inserting two announcements, at intervals of at least 14 days each time, in at least two daily newspapers designated by the warehousing company, inviting those who believe they have a title to the goods described in the missing receipt, to oppose their delivery or the issue of the duplicate receipt by service of a writ.',
            '47.3 If within 14 days of the last announcement no one has opposed the delivery or issue by service of a writ, the warehousing company may nullify the receipt and effect delivery of goods or issue a duplicate receipt to the applicant. For determining the nature and quantity of the goods to be delivered or to be described in the duplicate receipt, the warehousing company’s relevant records shall exclusively be regarded as standard. The nullification may immediately thereafter be published in the said newspapers. As a result of such nullification the original receipt shall lose its validity and all the warehousing company’s obligations under the original receipt shall cease.',
            '47.4 In case of opposition by a third party the application shall not be complied with, until it has appeared from a Court Order or other final and conclusive ruling or award that the applicant is the person entitled to the goods.',
            '47.5 The person obtaining delivery of the goods described in a duplicate receipt, shall indemnify the warehousing company against all claims resulting from such delivery. The warehousing company may require security for this purpose.',
            '47.6 Any costs in the widest sense, incurred by the warehousing company as a result of the application, shall be borne by the applicant. The warehousing company shall have the right to require an advance of money to be made before considering the application.',
          ],
        },
        {
          number: 48,
          title: 'Expiration of the validity of the receipt',
          numbered: false,
          paragraphs: [
            '48.1 If on expiry of the validity of the receipt the warehousing company no longer wishes to keep the goods in warehousing, they shall summon the last known receipt holder to remove the goods.',
            '48.2 If the receipt holder fails to comply with the summons within 14 days, or if he is no longer in possession of the expired receipt, and does not indicate the holder of the expired receipt within 14 days, nor does the holder of the expired receipt present himself within such period, the warehousing company shall have the right to sell the goods covered by the expired receipt.',
            '48.3 Prior to taking such action, the warehousing company shall publish it’s intention to sell goods for which an expired receipt is in circulation by inserting two announcements at intervals of at least 14 days in at least two daily newspapers each time, at least one of which appearing in the place where the warehousing company has it’s registered office, requesting the holder of the expired receipt to meet his obligations as yet, or notifying any persons having acquired the expired receipt.',
            '48.4 If 14 days after the last announcement the receipt holder has not presented himself, or if he has presented himself but no agreement has been reached on the removal of the goods, the warehousing company shall be at liberty to sell the goods immediately.',
            'The sale shall take place in accordance with the provisions of section 29.',
          ],
        },
        {
          number: 49,
          title: 'Commencement of period of extinction',
          numbered: false,
          paragraphs: [
            'The period of prescription and extinction as referred to in section 30 shall, in case of total loss, commence at the end of the day on which the warehousing company informs the last known receipt holder of such loss or if he is no longer in possession of the receipt and no subsequent receipt holder has presented himself to the warehousing company, a week after the announcement of such loss in two daily newspapers, at least one of which appearing in the place where the warehousing company have their registered office.',
          ],
        },
        {
          number: 50,
          title: 'Application of the provisions of this chapter',
          numbered: false,
          paragraphs: [
            '50.1 The provisions of this Chapter II shall exclusively apply to the legal relationship between the warehousing company and the receipt holder as such.',
            '50.2 The moment the receipt holder for whatever reason surrenders the receipt to the warehousing company the provisions of the present Chapter II shall cease to apply. As from such moment the provisions of Chapter I, regulating the legal relationship between the warehousing company and the principal, shall apply provided always that the warehousing company may enforce all their rights under the receipt.',
          ],
        },
      ],
    },
    {
      heading: 'Concluding paragraph',
      sections: [
        {
          number: 51,
          // The source calls this one an Article, not a Section.
          kind: 'article',
          title: 'Concluding paragraph',
          numbered: false,
          paragraphs: [
            'In case this English translation of our “Opslagvoorwaarden” (in Dutch) differs from the Dutch text, the latter will prevail.',
          ],
        },
      ],
    },
  ],
};
