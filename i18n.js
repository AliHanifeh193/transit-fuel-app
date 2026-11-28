"use strict";
(function(global){
  // UI language only; this never changes billing, API payloads, stored trip data or SMS routing.
  const languages = Object.freeze({fa:"فارسی",en:"English",tr:"Türkçe",ar:"العربية"});
  const translations = {"سامانه هوشمند مدیریت سوخت و هزینه‌های ترانزیت":["Transit Fuel — Smart Fuel & Trip Cost Management","Transit Fuel — Akıllı Yakıt ve Sefer Gider Yönetimi","ترانزيت فيول — إدارة الوقود وتكاليف الرحلات"],"محاسبه لحظه‌ای مصرف، سهمیه شرکت و راننده، جرایم مرزی، هزینه‌های سفر و آرشیو کامل":["Live fuel consumption, company and driver allocations, border fines, trip expenses and archive","Anlık yakıt tüketimi, şirket ve sürücü payları, sınır cezaları, sefer giderleri ve arşiv","حساب الاستهلاك والحصص والغرامات الحدودية ومصاريف الرحلة والأرشيف"],"همه بخش‌ها":["All sections","Tüm bölümler","جميع الأقسام"],"⛽ سوخت و مسیر":["⛽ Fuel & route","⛽ Yakıt ve rota","⛽ الوقود والمسار"],"💱 نرخ ارزها":["💱 Exchange rates","💱 Döviz kurları","💱 أسعار الصرف"],"🧾 هزینه‌ها و اسناد":["🧾 Expenses & documents","🧾 Giderler ve belgeler","🧾 المصروفات والمستندات"],"📤 ارسال و خروجی":["📤 Submit & export","📤 Gönder ve dışa aktar","📤 الإرسال والتصدير"],"✅ تأیید نهایی و خالص":["✅ Final approval & net","✅ Son onay ve net tutar","✅ الموافقة النهائية والصافي"],"💬 انتقادات و پیشنهادات":["💬 Feedback","💬 Görüş ve öneriler","💬 الملاحظات والاقتراحات"],"سامانه شرکت":["Company portal","Şirket paneli","بوابة الشركة"],"نام کاربری":["Username","Kullanıcı adı","اسم المستخدم"],"رمز عبور":["Password","Şifre","كلمة المرور"],"ورود":["Sign in","Giriş yap","تسجيل الدخول"],"ورود راننده با پیامک":["Driver SMS sign-in","Sürücü SMS ile giriş","دخول السائق برسالة نصية"],"شماره موبایل ایران یا ترکیه":["Iranian or Turkish mobile number","İran veya Türkiye cep telefonu numarası","رقم هاتف إيراني أو تركي"],"ارسال کد ورود":["Send sign-in code","Giriş kodunu gönder","إرسال رمز الدخول"],"تأیید کد یک‌بارمصرف":["Verify one-time code","Tek kullanımlık kod doğrulama","التحقق من الرمز لمرة واحدة"],"کد شش‌رقمی":["Six-digit code","Altı haneli kod","رمز من ستة أرقام"],"تأیید و ورود":["Verify & sign in","Doğrula ve giriş yap","تحقق وسجّل الدخول"],"بازگشت":["Back","Geri","رجوع"],"پشتیبان کامل":["Full backup","Tam yedek","نسخة احتياطية كاملة"],"بازیابی پشتیبان":["Restore backup","Yedeği geri yükle","استعادة النسخة الاحتياطية"],"چاپ گزارش":["Print report","Raporu yazdır","طباعة التقرير"],"حریم خصوصی و راهنمای کاربر":["Privacy & user guide","Gizlilik ve kullanıcı rehberi","الخصوصية ودليل المستخدم"],"راننده":["Driver","Sürücü","السائق"],"مدیر شرکت":["Company administrator","Şirket yöneticisi","مدير الشركة"],"حسابداری":["Accounting","Muhasebe","المحاسبة"],"ارسال‌شده":["Submitted","Gönderildi","تم الإرسال"],"بازبینی‌شده":["Reviewed","İncelendi","تمت المراجعة"],"ردشده":["Rejected","Reddedildi","مرفوض"],"تأییدشده":["Approved","Onaylandı","تمت الموافقة"],"تسویه‌شده":["Settled","Ödendi","تمت التسوية"],"نام کاربری یا رمز عبور نادرست است":["Incorrect username or password","Kullanıcı adı veya şifre hatalı","اسم المستخدم أو كلمة المرور غير صحيحة"],"دسترسی مجاز نیست":["Access denied","Erişim reddedildi","الوصول غير مسموح"],"کد نامعتبر یا منقضی شده است.":["Invalid or expired code.","Geçersiz veya süresi dolmuş kod.","الرمز غير صالح أو منتهي الصلاحية."],"درخواست تأیید نامعتبر است. دوباره کد بخواهید.":["Invalid verification request. Request a new code.","Geçersiz doğrulama isteği. Yeni kod isteyin.","طلب التحقق غير صالح. اطلب رمزًا جديدًا."],"شماره موبایل این حساب ثبت نشده است. با مدیر سامانه تماس بگیرید.":["No mobile number registered. Contact the administrator.","Bu hesaba telefon numarası tanımlanmamış. Yöneticiye başvurun.","لا يوجد رقم هاتف مسجل. اتصل بالمسؤول."],"ارسال پیامک در حال حاضر در دسترس نیست.":["SMS service is currently unavailable.","SMS hizmeti şu anda kullanılamıyor.","خدمة الرسائل غير متاحة حاليًا."],"رانندگان باید از ورود پیامکی استفاده کنند.":["Drivers must use SMS sign-in.","Sürücüler SMS ile giriş yapmalıdır.","يجب على السائقين الدخول عبر الرسائل النصية."],"تلاش‌های ورود زیاد است. بعداً دوباره امتحان کنید.":["Too many attempts. Try again later.","Çok fazla deneme. Daha sonra tekrar deneyin.","محاولات كثيرة. حاول لاحقًا."],"به‌روزرسانی":["Refresh","Yenile","تحديث"],"خروج":["Sign out","Çıkış yap","تسجيل الخروج"],"صندوق بازخورد":["Feedback inbox","Geri bildirim kutusu","صندوق الملاحظات"],"ذخیره سفر در آرشیو":["Save trip to archive","Seferi arşive kaydet","حفظ الرحلة في الأرشيف"],"بازنشانی سفر پیش‌فرض":["Reset sample trip","Örnek seferi sıfırla","إعادة ضبط الرحلة النموذجية"],"راهنمای اندروید و اپل":["Android & iPhone guide","Android ve iPhone rehberi","دليل أندرويد وآيفون"],"لغت / زبان":["Language","Dil","اللغة"],"زبان":["Language","Dil","اللغة"],"حریم خصوصی اطلاعات راننده هنگام ارسال گزارش":["Driver data privacy when submitting reports","Rapor gönderirken sürücü verilerinin gizliliği","خصوصية بيانات السائق عند إرسال التقارير"],"این بخش در حال آماده‌سازی است":["This section is being prepared","Bu bölüm hazırlanıyor","هذا القسم قيد الإعداد"]};
  Object.assign(translations,{"۱. مشخصات سفر، مسافت‌ها و ضرایب مصرف سوخت":["1. Trip details, distances & fuel rates","1. Sefer bilgileri, mesafeler ve yakıt tüketim oranları","١. تفاصيل الرحلة والمسافات ومعدلات استهلاك الوقود"],"محاسبه آنی":["Live calculation","Anlık hesaplama","حساب فوري"],"شماره سفر":["Trip number","Sefer numarası","رقم الرحلة"],"عنوان / مسیر سفر":["Trip title / route","Sefer başlığı / güzergâh","عنوان الرحلة / المسار"],"شماره پلاک کشنده / تریلر":["Truck / trailer plate","Çekici / dorse plakası","لوحة الشاحنة / المقطورة"],"تاریخ شروع سفر":["Trip start date","Sefer başlangıç tarihi","تاريخ بدء الرحلة"],"کل گازوئیل موجود در باک (لیتر)":["Initial fuel in tank (L)","Depodaki başlangıç yakıtı (L)","الوقود الابتدائي في الخزان (لتر)"],"سهمیه سوخت شرکت برای کل مسیر (لیتر)":["Company fuel allowance for entire route (L)","Tüm rota için şirket yakıt kotası (L)","حصة الشركة من الوقود للمسار (لتر)"],"سوخت اضافی مسیر رفت (لیتر)":["Extra outbound fuel (L)","Gidiş ilave yakıtı (L)","الوقود الإضافي للذهاب (لتر)"],"سوخت اضافی مسیر برگشت (لیتر)":["Extra return fuel (L)","Dönüş ilave yakıtı (L)","الوقود الإضافي للعودة (لتر)"],"نرخ فروش هر لیتر سوخت (لیر)":["Fuel sale price per liter (TRY)","Litre başına yakıt satış fiyatı (TRY)","سعر بيع لتر الوقود (ليرة)"],"مسیر رفت (بارگیری / اعزام)":["Outbound route (loading / dispatch)","Gidiş rotası (yükleme / sevk)","مسار الذهاب (التحميل / الإرسال)"],"مسیر برگشت":["Return route","Dönüş rotası","مسار العودة"],"مسافت رفت (کیلومتر)":["Outbound distance (km)","Gidiş mesafesi (km)","مسافة الذهاب (كم)"],"وزن بار رفت (تن)":["Outbound cargo (t)","Gidiş yük ağırlığı (ton)","وزن الحمولة ذهابًا (طن)"],"ضریب مصرف رفت (لیتر / ۱۰۰ کم)":["Outbound consumption (L/100 km)","Gidiş tüketimi (L/100 km)","استهلاك الذهاب (لتر/١٠٠ كم)"],"💾 ذخیره سفر در آرشیو":["💾 Save trip to archive","💾 Seferi arşive kaydet","💾 حفظ الرحلة في الأرشيف"],"↺ بازنشانی سفر پیش‌فرض":["↺ Reset sample trip","↺ Örnek seferi sıfırla","↺ إعادة ضبط الرحلة النموذجية"],"● ذخیره خودکار روی حافظه گوشی فعال است":["● Local autosave enabled","● Yerel otomatik kayıt etkin","● الحفظ التلقائي المحلي مفعل"],"⛽ وضعیت لحظه‌ای باک و تفکیک سهمیه سوخت":["⛽ Live tank and fuel allocation","⛽ Anlık depo ve yakıt payları","⛽ حالة الخزان وحصص الوقود"],"مصرف کل سفر:":["Total trip consumption:","Toplam sefer tüketimi:","إجمالي استهلاك الرحلة:"],"اضافه‌سوخت شرکت (قابل فروش):":["Company surplus fuel (sellable):","Şirket fazla yakıtı (satılabilir):","فائض وقود الشركة (قابل للبيع):"],"سهم سوخت شخصی شما:":["Your personal fuel share:","Kişisel yakıt payınız:","حصتك الشخصية من الوقود:"],"کل باقیمانده واقعی باک:":["Actual fuel remaining:","Depoda kalan gerçek yakıt:","الوقود الفعلي المتبقي:"],"مقدار اضافه سوخت و درآمد/سهم از فروش فقط در صورت موافقت راننده ارسال می‌شوند.":["Surplus fuel and revenue shares are sent only with driver consent.","Fazla yakıt ve satış geliri yalnızca sürücünün onayıyla gönderilir.","لا تُرسل بيانات فائض الوقود وحصة الإيراد إلا بموافقة السائق."]});
  Object.assign(translations,{"📲 نصب اپلیکیشن روی گوشی اندروید و آیفون (iOS)":["📲 Install app on Android & iPhone (iOS)","📲 Android ve iPhone'a uygulama yükle (iOS)","📲 تثبيت التطبيق على أندرويد وآيفون (iOS)"],"در اندروید با دکمه نصب یا منوی مرورگر «Add to Home Screen» و در آیفون از منوی Share گزینه «Add to Home Screen» را بزنید.":["On Android use Install or Add to Home Screen; on iPhone choose Share → Add to Home Screen.","Android'de Yükle veya Ana ekrana ekle; iPhone'da Paylaş → Ana Ekrana Ekle seçeneğini kullanın.","على أندرويد اختر تثبيت أو إضافة إلى الشاشة الرئيسية؛ وعلى آيفون اختر مشاركة ثم إضافة إلى الشاشة الرئيسية."],"📱 نصب روی گوشی !":["📱 Install on phone","📱 Telefona yükle","📱 تثبيت على الهاتف"],"نصب روی گوشی !":["Install on phone","Telefona yükle","تثبيت على الهاتف"],"📂 آرشیو سفرها (":["📂 Trip archive (","📂 Sefer arşivi (","📂 أرشيف الرحلات ("],"آخرین به‌روزرسانی: همین لحظه":["Last updated: just now","Son güncelleme: şimdi","آخر تحديث: الآن"],"اطلاعات پایه سفر، موجودی و سهمیه سوخت، مسافت و ضریب مصرف را وارد کنید تا محاسبات لحظه‌ای انجام شود.":["Enter trip details, initial fuel, allowance, distance and consumption rate to calculate live totals.","Anlık hesaplama için sefer bilgilerini, yakıtı, kotayı, mesafeyi ve tüketim oranını girin.","أدخل بيانات الرحلة والوقود والحصة والمسافة ومعدل الاستهلاك للحساب الفوري."],"مثلاً 1405-012":["e.g. 1405-012","ör. 1405-012","مثال 1405-012"],"مانده باک:":["Fuel remaining:","Depoda kalan yakıt:","الوقود المتبقي:"],"لیتر":["L","Litre","لتر"],"آخرین ذخیره خودکار:":["Last autosave:","Son otomatik kayıt:","آخر حفظ تلقائي:"],"امکان نصب مستقیم روی دستگاه آماده است. دکمه «نصب روی گوشی» را بزنید.":["Direct installation is available. Select Install on phone.","Doğrudan yükleme hazır. Telefona yükle seçeneğini kullanın.","التثبيت المباشر متاح. اختر التثبيت على الهاتف."],"اپلیکیشن با موفقیت روی دستگاه نصب شد.":["App installed successfully.","Uygulama başarıyla yüklendi.","تم تثبيت التطبيق بنجاح."],"اپلیکیشن نصب شد":["App installed","Uygulama yüklendi","تم تثبيت التطبيق"]});
  const order=["en","tr","ar"];
  const key="transit_fuel_ui_language_v1";
  function selected(){
    try {const v=localStorage.getItem(key);return Object.hasOwn(languages,v)?v:"fa";}catch{return "fa";}
  }
  const lang=selected();
  const index=order.indexOf(lang);
  const prefixKeys = ["📂 آرشیو سفرها (","مانده باک:","آخرین ذخیره خودکار:","مصرف کل سفر:","اضافه‌سوخت شرکت (قابل فروش):","سهم سوخت شخصی شما:","کل باقیمانده واقعی باک:"];
  function t(text){
    if(index<0 || typeof text!=="string")return text;
    if(translations[text])return translations[text][index] || text;
    for(const key of prefixKeys){
      if(text.startsWith(key))return translations[key]?.[index] + text.slice(key.length);
    }
    return text;
  }
  // Translate only complete static UI text nodes, never input values or financial content.
  function translateTree(root){
    if(lang==="fa") return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const changes=[];
    while(walker.nextNode()){
      const n=walker.currentNode;
      const el=n.parentElement;
      if(!el || /^(SCRIPT|STYLE|TEXTAREA|OPTION|CODE|PRE|INPUT)$/i.test(el.tagName) || el.closest("[data-no-translate]"))continue;
      const raw=n.nodeValue,trimmed=raw.trim();
      if(trimmed && t(trimmed)!==trimmed){
        changes.push([n,raw.replace(trimmed,t(trimmed))]);
      }
    }
    for(const [node,value] of changes) node.nodeValue=value;
  }
  function showSelector(){
    if(document.getElementById("transitLanguageSelect"))return;
    const holder=document.createElement("label");
    holder.className="transit-language-picker";
    holder.style.cssText="display:inline-flex;align-items:center;gap:.45rem;margin:.35rem 0;padding:.45rem .65rem;border:1px solid #52647a;border-radius:10px;background:#112238;color:#f6faff;font:14px system-ui,sans-serif;direction:ltr";
    const caption=document.createElement("span");caption.textContent=t("زبان")+":";
    const select=document.createElement("select");select.id="transitLanguageSelect";
    select.setAttribute("aria-label","Language / زبان");
    select.style.cssText="background:#0b1729;color:#fff;border:1px solid #627b91;border-radius:6px;padding:.35rem";
    for(const [code,name] of Object.entries(languages)){
      const option=document.createElement("option");option.value=code;option.textContent=name;
      select.appendChild(option);
    }
    select.value=lang;
    select.addEventListener("change",()=>{
      try{localStorage.setItem(key,select.value);}catch{}
      location.reload();
    });
    holder.append(caption,select);
    const head=document.querySelector(".header-actions")||document.querySelector("header")||document.body;
    head.prepend(holder);
  }
  function boot(){
    document.documentElement.lang=lang;
    document.documentElement.dir=(lang==="fa"||lang==="ar")?"rtl":"ltr";
    showSelector();
    document.title=t("سامانه هوشمند مدیریت سوخت و هزینه‌های ترانزیت");
    translateTree(document.body);
    if(lang!=="fa"){
      const observer=new MutationObserver(mutations=>{
        for(const mutation of mutations){
          if(mutation.type==="characterData") translateTree(mutation.target.parentElement||document.body);
          else for(const added of mutation.addedNodes){
            if(added.nodeType===1)translateTree(added);
            else if(added.nodeType===3 && added.parentElement)translateTree(added.parentElement);
          }
        }
      });
      observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    }
    window.dispatchEvent(new CustomEvent("transit-language-ready",{detail:{language:lang}}));
  }
  global.TransitI18n=Object.freeze({language:lang,languages,t});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})(window);
