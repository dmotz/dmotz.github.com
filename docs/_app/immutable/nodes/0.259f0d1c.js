import{s as c,e as f,u as _,g as d,f as p}from"../chunks/scheduler.ed6d665d.js";import{S as m,i as g,d as u,v,f as $,t as b}from"../chunks/index.8e0e3fa3.js";const y=!0,L=Object.freeze(Object.defineProperty({__proto__:null,prerender:y},Symbol.toStringTag,{value:"Module"}));function r(s){let o;const a=s[1].default,e=f(a,s,s[0],null),i={c:function(){e&&e.c()},l:function(t){e&&e.l(t)},m:function(t,l){e&&e.m(t,l),o=!0},p:function(t,[l]){e&&e.p&&(!o||l&1)&&_(e,a,t,t[0],o?p(a,t[0],l,null):d(t[0]),null)},i:function(t){o||($(e,t),o=!0)},o:function(t){b(e,t),o=!1},d:function(t){e&&e.d(t)}};return u("SvelteRegisterBlock",{block:i,id:r.name,type:"component",source:"",ctx:s}),i}function h(s,o,a){let{$$slots:e={},$$scope:i}=o;v("Layout",e,["default"]);const n=[];return Object.keys(o).forEach(t=>{!~n.indexOf(t)&&t.slice(0,2)!=="$$"&&t!=="slot"&&console.warn(`<Layout> was created with unknown prop '${t}'`)}),s.$$set=t=>{"$$scope"in t&&a(0,i=t.$$scope)},[i,e]}class O extends m{constructor(o){super(o),g(this,o,h,r,c,{}),u("SvelteRegisterComponent",{component:this,tagName:"Layout",options:o,id:r.name})}}export{O as component,L as universal};
