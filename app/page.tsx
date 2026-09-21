import { redirect } from 'next/navigation'

/** 首页没有内容，直接进客户列表（技术栈文档 5.2 的页面约定） */
export default function Home() {
  redirect('/customers')
}
